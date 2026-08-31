// SPDX-License-Identifier: MPL-2.0
import {
  StructureElement,
  StructureProperties,
  Unit,
  to_mmCIF,
} from 'molstar/lib/mol-model/structure.js';
import { createStructureRepresentationParams } from 'molstar/lib/mol-plugin-state/helpers/structure-representation-params.js';
import { structureUnion } from 'molstar/lib/mol-model/structure/query/utils/structure-set.js';
import {
  clearStructureOverpaint,
  setStructureOverpaint,
} from 'molstar/lib/mol-plugin-state/helpers/structure-overpaint.js';
import { PluginBehaviors } from 'molstar/lib/mol-plugin/behavior.js';
import { StructureFocusRepresentation } from 'molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation.js';
import { PluginConfig } from 'molstar/lib/mol-plugin/config.js';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { PluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { Task } from 'molstar/lib/mol-task/task.js';
import { Color } from 'molstar/lib/mol-util/color/index.js';

import { StructureLoadError } from '../structures/loaders/errors';
import type {
  LoadedStructureData,
  SelectedResidue,
  ViewerLoadResult,
} from '../structures/types';
import type {
  StructureColorMode,
  StructureExport,
  StructureRepresentation,
  SelectionRepresentation,
  StructureViewer,
  ViewerEvents,
  ViewerSelection,
} from './StructureViewer';
import {
  structureExportBlockName,
  structureExportFilename,
} from './structureExport';
import { extractMolstarMetadata } from './molstarMetadata';
import { atomicResidueLociFromClick } from './molstarInteraction';
import {
  MolstarComponentTag,
  hasMolstarTag,
} from './molstarState';
import {
  cappedPixelRatio,
  pixelScaleForQuality,
  qualityForAtomCount,
} from './viewerConfig';

type Subscription = { unsubscribe(): void };

function addSchemaItem(
  items: StructureElement.SchemaItem[],
  item: StructureElement.SchemaItem,
  chainId?: string,
): void {
  if (chainId === undefined) {
    items.push(item);
    return;
  }
  items.push(
    { ...item, auth_asym_id: chainId },
    { ...item, label_asym_id: chainId },
  );
}

function createSpec(pixelScale: number): PluginSpec {
  const dark =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    actions: [],
    animations: [],
    behaviors: [
      PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci),
      PluginSpec.Behavior(PluginBehaviors.Representation.SelectLoci),
      PluginSpec.Behavior(PluginBehaviors.Representation.DefaultLociLabelProvider),
      PluginSpec.Behavior(PluginBehaviors.Representation.FocusLoci),
      PluginSpec.Behavior(PluginBehaviors.Camera.FocusLoci),
      PluginSpec.Behavior(PluginBehaviors.Camera.CameraControls),
      PluginSpec.Behavior(StructureFocusRepresentation),
      PluginSpec.Behavior(PluginBehaviors.CustomProps.StructureInfo),
      PluginSpec.Behavior(PluginBehaviors.CustomProps.SecondaryStructure),
      PluginSpec.Behavior(PluginBehaviors.CustomProps.ValenceModel),
    ],
    canvas3d: {
      cameraResetDurationMs: 180,
      hiZ: { enabled: false },
      illumination: { enabled: false },
      multiSample: { mode: 'off' },
      postprocessing: { enabled: false },
      renderer: {
        backgroundColor: Color(dark ? 0x151719 : 0xf7f8f9),
        highlightColor: Color(0x4f8fc7),
        selectColor: Color(0xe28b3d),
      },
    },
    config: [
      [PluginConfig.General.DisableAntialiasing, false],
      [PluginConfig.General.DisablePreserveDrawingBuffer, true],
      [PluginConfig.General.PixelScale, pixelScale],
      [PluginConfig.General.PickScale, 0.25],
      [PluginConfig.General.PowerPreference, 'high-performance'],
      [PluginConfig.General.ResolutionMode, 'scaled'],
      [PluginConfig.General.Transparency, 'blended'],
      [PluginConfig.State.HistoryCapacity, 0],
      [PluginConfig.VolumeStreaming.Enabled, false],
    ],
  };
}

function schemaForSelection(selection: ViewerSelection): StructureElement.Schema {
  const items: StructureElement.SchemaItem[] = [];
  for (const chainId of selection.chains ?? []) {
    addSchemaItem(items, {}, chainId);
  }
  for (const residue of selection.residues ?? []) {
    addSchemaItem(
      items,
      {
        auth_seq_id: residue.number,
        ...(residue.insertionCode === undefined
          ? {}
          : { pdbx_PDB_ins_code: residue.insertionCode }),
      },
      residue.chainId,
    );
  }
  for (const ligand of selection.ligands ?? []) {
    addSchemaItem(
      items,
      { label_comp_id: ligand.compId.toUpperCase() },
      ligand.chainId,
    );
  }
  return { items };
}

function waitForFrame(timeoutMs = 1_000): Promise<void> {
  return new Promise((resolve) => {
    let secondFrame: number | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
      resolve();
    };

    const timeout = window.setTimeout(finish, timeoutMs);
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(finish);
    });
  });
}

function cleanCifValue(value: string): string {
  return value === '.' || value === '?' ? '' : value;
}

function abortedError(cause?: unknown): StructureLoadError {
  return new StructureLoadError(
    'aborted',
    'Loading was cancelled',
    cause === undefined ? undefined : { cause },
  );
}

export class MolstarViewer implements StructureViewer {
  readonly #defaultPixelScale: number;
  readonly #events: ViewerEvents;
  readonly #plugin: PluginContext;
  readonly #subscriptions: Subscription[] = [];
  #colorMode: StructureColorMode = 'chain';
  #currentLoci: StructureElement.Loci | null = null;
  #disposed = false;
  #exportIdentity: { blockName: string; filename: string } | undefined;
  #hiddenChains = new Set<string>();
  #hoverFrame: number | undefined;
  #hoverKey = '';
  #loadGeneration = 0;
  #quality = qualityForAtomCount(0);
  #representation: Extract<StructureRepresentation, 'cartoon' | 'surface'> =
    'cartoon';

  private constructor(events: ViewerEvents) {
    this.#events = events;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    this.#defaultPixelScale = cappedPixelRatio(dpr);
    this.#plugin = new PluginContext(createSpec(this.#defaultPixelScale));
  }

  static async create(
    container: HTMLElement,
    events: ViewerEvents = {},
  ): Promise<MolstarViewer> {
    const viewer = new MolstarViewer(events);
    try {
      await viewer.#plugin.init();
      const mounted = await viewer.#plugin.mountAsync(container);
      if (!mounted) throw new Error('WebGL is unavailable');
      viewer.#bindEvents();
      return viewer;
    } catch (error) {
      viewer.dispose();
      throw new StructureLoadError(
        'webgl-unavailable',
        'WebGL is unavailable',
        { cause: error },
      );
    }
  }

  async load(data: LoadedStructureData): Promise<ViewerLoadResult> {
    this.#assertActive();
    const generation = ++this.#loadGeneration;
    const totalStartedAt = performance.now();
    try {
      await this.#clearState('Structure replaced');
      this.#assertLoadGeneration(generation);

      const raw = await this.#plugin.builders.data.rawData(
        { data: data.data, label: data.label },
        { state: { isGhost: true } },
      );
      this.#assertLoadGeneration(generation);

      const parseStartedAt = performance.now();
      const trajectory = await this.#plugin.builders.structure.parseTrajectory(
        raw,
        data.format,
      );
      const parseMs = performance.now() - parseStartedAt;
      this.#assertLoadGeneration(generation);

      const structureStartedAt = performance.now();
      const model = await this.#plugin.builders.structure.createModel(trajectory);
      this.#assertLoadGeneration(generation);
      const modelProperties =
        await this.#plugin.builders.structure.insertModelProperties(model);
      this.#assertLoadGeneration(generation);
      const structure = await this.#plugin.builders.structure.createStructure(
        modelProperties,
        { name: 'model', params: {} },
      );
      this.#assertLoadGeneration(generation);
      const structureProperties =
        await this.#plugin.builders.structure.insertStructureProperties(structure);
      this.#assertLoadGeneration(generation);
      const structureData = structureProperties.cell?.obj?.data;
      if (structureData === undefined) {
        throw new Error('The structure could not be parsed');
      }
      const structureMs = performance.now() - structureStartedAt;

      this.#quality = qualityForAtomCount(structureData.elementCount);
      this.#plugin.canvas3dContext?.setProps({
        pixelScale: pixelScaleForQuality(
          this.#defaultPixelScale,
          this.#quality.tier,
        ),
      });
      await this.#plugin.managers.structure.component.setOptions({
        ...this.#plugin.managers.structure.component.state.options,
        hydrogens: 'hide-all',
        visualQuality: this.#quality.quality,
      });
      this.#assertLoadGeneration(generation);

      const renderStartedAt = performance.now();
      await this.#plugin.builders.structure.representation.applyPreset(
        structureProperties,
        'polymer-and-ligand',
        {
          ignoreHydrogens: true,
          ignoreHydrogensVariant: 'all',
          quality: this.#quality.quality,
          theme: {
            globalName: 'chain-id',
            carbonColor: 'chain-id',
          },
        },
      );
      this.#assertLoadGeneration(generation);
      this.#hideWater();
      const renderMs = performance.now() - renderStartedAt;
      const firstFrameStartedAt = performance.now();
      await waitForFrame();
      this.#assertLoadGeneration(generation);
      const firstFrameMs = performance.now() - firstFrameStartedAt;
      const filename = structureExportFilename(data);
      this.#exportIdentity = {
        blockName: structureExportBlockName(filename),
        filename,
      };

      return {
        metadata: extractMolstarMetadata(structureData, data.source),
        timings: {
          ...(data.downloadMs === undefined
            ? {}
            : { downloadMs: data.downloadMs }),
          firstFrameMs,
          parseMs,
          renderMs,
          structureMs,
          totalMs: performance.now() - totalStartedAt,
        },
      };
    } catch (error) {
      if (Task.isAbort(error) || generation !== this.#loadGeneration) {
        throw abortedError(error);
      }
      if (error instanceof StructureLoadError) throw error;
      throw new StructureLoadError(
        'invalid-file',
        'The structure could not be parsed or rendered',
        { cause: error },
      );
    }
  }

  async clear(): Promise<void> {
    this.#assertActive();
    this.#loadGeneration += 1;
    await this.#clearState('Structure cleared');
  }

  async #clearState(reason: string): Promise<void> {
    this.#plugin.managers.task.requestAbortAll(reason);
    this.#currentLoci = null;
    this.#exportIdentity = undefined;
    this.#hiddenChains.clear();
    this.#colorMode = 'chain';
    this.#representation = 'cartoon';
    this.#plugin.canvas3dContext?.setProps({
      pixelScale: this.#defaultPixelScale,
    });
    await this.#plugin.clear();
  }

  exportCurrentStructure(): StructureExport {
    this.#assertActive();
    const structure = this.#visibleStructure();
    const identity = this.#exportIdentity;
    if (
      structure === undefined ||
      structure.elementCount === 0 ||
      identity === undefined
    ) {
      throw new Error('No visible structure is available to export');
    }

    const text = to_mmCIF(identity.blockName, structure, false, {
      copyAllCategories: true,
    });
    if (typeof text !== 'string') {
      throw new Error('The structure could not be exported as text mmCIF');
    }
    return {
      filename: identity.filename,
      mimeType: 'chemical/x-cif',
      text,
    };
  }

  resetCamera(): void {
    this.#plugin.managers.camera.reset(undefined, 180);
  }

  resize(): void {
    this.#plugin.handleResize();
  }

  focusChain(chainId: string): void {
    const structure = this.#rootStructure();
    if (structure === undefined) return;
    this.#plugin.managers.camera.focusLoci(
      StructureElement.Schema.toLoci(
        structure,
        schemaForSelection({ chains: [chainId] }),
      ),
      { durationMs: 180 },
    );
  }

  select(selection: ViewerSelection): void {
    const structure = this.#rootStructure();
    if (structure === undefined) return;
    const loci = StructureElement.Schema.toLoci(
      structure,
      schemaForSelection(selection),
    );
    this.#currentLoci = loci;
    this.#plugin.managers.interactivity.lociSelects.selectOnly({ loci }, false);
  }

  focusSelection(): void {
    if (this.#currentLoci === null) return;
    this.#plugin.managers.camera.focusLoci(this.#currentLoci, { durationMs: 180 });
  }

  async setChainVisible(chainId: string, visible: boolean): Promise<void> {
    const wasHidden = this.#hiddenChains.has(chainId);
    if (visible) this.#hiddenChains.delete(chainId);
    else this.#hiddenChains.add(chainId);
    try {
      await this.#restoreRepresentations();
    } catch (error) {
      if (wasHidden) this.#hiddenChains.add(chainId);
      else this.#hiddenChains.delete(chainId);
      throw error;
    }
  }

  async showAll(): Promise<void> {
    const previouslyHidden = new Set(this.#hiddenChains);
    this.#hiddenChains.clear();
    try {
      await this.#restoreRepresentations();
    } catch (error) {
      this.#hiddenChains = previouslyHidden;
      throw error;
    }
  }

  async isolate(selection: ViewerSelection): Promise<void> {
    const structureRef = this.#structureRef();
    const structure = this.#rootStructure();
    const structureCell = this.#structureCell();
    if (
      structureRef === undefined ||
      structure === undefined ||
      structureCell === undefined
    ) {
      return;
    }
    const schema = schemaForSelection(selection);
    const loci = StructureElement.Schema.toLoci(structure, schema);
    if (StructureElement.Loci.isEmpty(loci)) return;

    await this.#plugin.managers.structure.component.clear([structureRef]);
    const component = await this.#plugin.builders.structure.tryCreateComponentFromExpression(
      structureCell,
      StructureElement.Schema.toExpression(schema),
      'protpeek-isolate',
      {
        label: 'Isolated selection',
        tags: [MolstarComponentTag.isolate],
      },
    );
    if (component === undefined) {
      await this.#restoreRepresentations();
      return;
    }
    const isWholeChain =
      (selection.chains?.length ?? 0) > 0 &&
      (selection.residues?.length ?? 0) === 0 &&
      (selection.ligands?.length ?? 0) === 0;
    const color = this.#colorMode === 'chain'
      ? 'chain-id'
      : this.#colorMode === 'residue-type'
        ? 'residue-name'
        : 'uniform';
    const colorParams = this.#colorMode === 'uniform'
      ? { value: Color(0x7890a8) }
      : undefined;
    try {
      await this.#plugin.builders.structure.representation.addRepresentation(
        component,
        isWholeChain
          ? this.#representation === 'surface'
            ? {
                type: 'molecular-surface',
                color,
                ...(colorParams === undefined ? {} : { colorParams }),
                typeParams: {
                  ignoreHydrogens: true,
                  quality: this.#quality.quality,
                  resolution: this.#quality.surfaceResolution,
                },
              }
            : {
                type: 'cartoon',
                color,
                ...(colorParams === undefined ? {} : { colorParams }),
                typeParams: { quality: this.#quality.quality },
              }
          : {
              type: 'ball-and-stick',
              color,
              ...(colorParams === undefined ? {} : { colorParams }),
              typeParams: {
                ignoreHydrogens: true,
                quality: this.#quality.quality,
              },
            },
      );
    } catch (error) {
      await this.#restoreRepresentations();
      throw error;
    }
  }

  async colorSelection(color: number | null): Promise<void> {
    const components = this.#structureRef()?.components ?? [];
    if (color === null) {
      await clearStructureOverpaint(this.#plugin, [...components]);
      return;
    }
    if (this.#currentLoci === null) return;
    const loci = this.#currentLoci;
    await setStructureOverpaint(
      this.#plugin,
      [...components],
      Color(color),
      () => Promise.resolve(loci),
    );
  }

  async setColorMode(mode: StructureColorMode): Promise<void> {
    await this.#applyColorMode(mode);
    this.#colorMode = mode;
  }

  async #applyColorMode(mode: StructureColorMode): Promise<void> {
    const components = this.#structureRef()?.components ?? [];
    const color =
      mode === 'chain' ? 'chain-id' : mode === 'residue-type' ? 'residue-name' : 'uniform';
    await this.#plugin.managers.structure.component.updateRepresentationsTheme(
      [...components],
      mode === 'uniform'
        ? { color, colorParams: { value: Color(0x7890a8) } }
        : { color },
    );
  }

  async setRepresentation(representation: StructureRepresentation): Promise<void> {
    try {
      await this.#applyRepresentation(representation);
      this.#representation = representation;
    } catch (error) {
      if (Task.isAbort(error)) throw abortedError(error);
      throw error;
    }
  }

  async setSelectionRepresentation(
    representation: SelectionRepresentation,
  ): Promise<void> {
    try {
      await this.#createSelectionRepresentation(representation);
    } catch (error) {
      if (Task.isAbort(error)) throw abortedError(error);
      throw error;
    }
  }

  async #applyRepresentation(
    representation: Extract<StructureRepresentation, 'cartoon' | 'surface'>,
  ): Promise<void> {
    const targets = this.#representationTargets();
    for (const component of targets) {
      const structure = component.cell.obj?.data;
      if (structure === undefined) continue;
      const color = this.#colorMode === 'chain'
        ? 'chain-id'
        : this.#colorMode === 'residue-type'
          ? 'residue-name'
          : 'uniform';
      const colorParams = this.#colorMode === 'uniform'
        ? { value: Color(0x7890a8) }
        : undefined;
      const params = representation === 'surface'
        ? createStructureRepresentationParams(this.#plugin, structure, {
            type: 'molecular-surface',
            color,
            ...(colorParams === undefined ? {} : { colorParams }),
            typeParams: {
              ignoreHydrogens: true,
              quality: this.#quality.quality,
              resolution: this.#quality.surfaceResolution,
            },
          })
        : createStructureRepresentationParams(this.#plugin, structure, {
            type: 'cartoon',
            color,
            ...(colorParams === undefined ? {} : { colorParams }),
            typeParams: {
              quality: this.#quality.quality,
            },
          });

      if (component.representations.length === 0) {
        await this.#plugin.builders.structure.representation.addRepresentation(
          component.cell,
          representation === 'surface'
            ? {
                type: 'molecular-surface',
                color,
                ...(colorParams === undefined ? {} : { colorParams }),
                typeParams: {
                  ignoreHydrogens: true,
                  quality: this.#quality.quality,
                  resolution: this.#quality.surfaceResolution,
                },
              }
            : {
                type: 'cartoon',
                color,
                ...(colorParams === undefined ? {} : { colorParams }),
                typeParams: {
                  quality: this.#quality.quality,
                },
              },
        );
        continue;
      }

      const update = this.#plugin.build();
      for (const current of component.representations) {
        update.to(current.cell).update(params);
      }
      await update.commit({ revertOnError: true });
    }
  }

  setTheme(dark: boolean): void {
    this.#plugin.canvas3d?.setProps({
      renderer: { backgroundColor: Color(dark ? 0x151719 : 0xf7f8f9) },
    });
  }

  cancelCurrentTask(): void {
    this.#loadGeneration += 1;
    this.#plugin.managers.task.requestAbortAll('Cancelled by user');
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#loadGeneration += 1;
    this.#plugin.managers.task.requestAbortAll('Viewer disposed');
    if (this.#hoverFrame !== undefined) cancelAnimationFrame(this.#hoverFrame);
    for (const subscription of this.#subscriptions) subscription.unsubscribe();
    this.#plugin.dispose();
  }

  async #restoreRepresentations(): Promise<void> {
    const structureRef = this.#structureRef();
    const structureCell = this.#structureCell();
    if (structureRef === undefined || structureCell === undefined) return;
    await this.#plugin.managers.structure.component.clear([structureRef]);
    await this.#plugin.builders.structure.representation.applyPreset(
      structureCell,
      'polymer-and-ligand',
      {
        ignoreHydrogens: true,
        ignoreHydrogensVariant: 'all',
        quality: this.#quality.quality,
        theme: { globalName: 'chain-id', carbonColor: 'chain-id' },
      },
    );
    this.#hideWater();
    await this.#applyHiddenChains();
    if (this.#representation !== 'cartoon') {
      await this.#applyRepresentation(this.#representation);
    }
    if (this.#colorMode !== 'chain') {
      await this.#applyColorMode(this.#colorMode);
    }
  }

  async #applyHiddenChains(): Promise<void> {
    if (this.#hiddenChains.size === 0) return;
    const structure = this.#rootStructure();
    const polymer = this.#structureRef()?.components.find((component) =>
      hasMolstarTag(component.cell.transform.tags, MolstarComponentTag.polymer),
    );
    if (structure === undefined || polymer === undefined) return;

    const loci = StructureElement.Schema.toLoci(
      structure,
      schemaForSelection({ chains: [...this.#hiddenChains] }),
    );
    if (StructureElement.Loci.isEmpty(loci)) return;

    this.#plugin.managers.structure.selection.fromLoci('set', loci, false);
    try {
      await this.#plugin.managers.structure.component.modifyByCurrentSelection(
        [polymer],
        'subtract',
      );
    } finally {
      this.#plugin.managers.interactivity.lociSelects.deselectAll();
      if (this.#currentLoci !== null) {
        this.#plugin.managers.interactivity.lociSelects.selectOnly(
          { loci: this.#currentLoci },
          false,
        );
      }
    }
  }

  async #createSelectionRepresentation(
    representation: SelectionRepresentation,
  ): Promise<void> {
    const structureRef = this.#structureRef();
    const structureCell = this.#structureCell();
    if (structureRef === undefined || structureCell === undefined) return;
    const existing = structureRef.components.filter(
      (component) =>
        hasMolstarTag(
          component.cell.transform.tags,
          MolstarComponentTag.selection,
        ),
    );
    if (existing.length > 0) {
      await this.#plugin.managers.structure.hierarchy.remove(existing, true);
    }
    if (representation === 'highlight' || this.#currentLoci === null) return;
    const component = await this.#plugin.builders.structure.tryCreateComponentFromExpression(
      structureCell,
      StructureElement.Bundle.toExpression(
        StructureElement.Bundle.fromLoci(this.#currentLoci),
      ),
      'protpeek-selection',
      {
        label: 'Selected residues',
        tags: [MolstarComponentTag.selection],
      },
    );
    if (component === undefined) return;
    await this.#plugin.builders.structure.representation.addRepresentation(component, {
      type: 'ball-and-stick',
      color: 'element-symbol',
      typeParams: {
        ignoreHydrogens: true,
        quality: this.#quality.quality,
        sizeFactor: representation === 'sticks' ? 0.18 : 0.3,
      },
    });
  }

  #hideWater(): void {
    const water = this.#structureRef()?.components.find(
      (component) =>
        hasMolstarTag(component.cell.transform.tags, MolstarComponentTag.water),
    );
    if (water !== undefined && !water.cell.state.isHidden) {
      this.#plugin.managers.structure.component.toggleVisibility([water]);
    }
  }

  #bindEvents(): void {
    this.#plugin.selectionMode = true;
    this.#plugin.managers.interactivity.setProps({ granularity: 'residue' });
    this.#subscriptions.push(
      this.#plugin.behaviors.interaction.click.subscribe((event) => {
        const residueLoci = atomicResidueLociFromClick(event.current.loci);
        this.#currentLoci = residueLoci;
        if (residueLoci === null) {
          this.#plugin.managers.interactivity.lociSelects.deselectAll();
        } else {
          // Mol* toggles a repeated click by default. ProtPeek keeps the clicked
          // residue selected so the 3D view and the sequence panel never drift.
          this.#plugin.managers.interactivity.lociSelects.selectOnly(
            { loci: residueLoci },
            false,
          );
        }
        this.#events.onSelection?.(this.#residueFromLoci(residueLoci));
      }),
      this.#plugin.behaviors.interaction.hover.subscribe((event) => {
        const residue = this.#residueFromLoci(event.current.loci);
        const key = residue === null
          ? ''
          : `${residue.chainId}:${residue.number}:${residue.insertionCode}:${residue.compId}`;
        if (key === this.#hoverKey) return;
        this.#hoverKey = key;
        if (this.#hoverFrame !== undefined) cancelAnimationFrame(this.#hoverFrame);
        this.#hoverFrame = requestAnimationFrame(() => {
          this.#hoverFrame = undefined;
          this.#events.onHover?.(residue);
        });
      }),
    );

    const context = this.#plugin.canvas3dContext;
    if (
      context?.contextLost !== undefined &&
      context.contextRestored !== undefined
    ) {
      this.#subscriptions.push(
        context.contextLost.subscribe(() => this.#events.onContextLost?.()),
        context.contextRestored.subscribe(() => this.#events.onContextRestored?.()),
      );
    }
  }

  #residueFromLoci(loci: unknown): SelectedResidue | null {
    if (!StructureElement.Loci.is(loci)) return null;
    let selected: SelectedResidue | null = null;
    StructureElement.Loci.forEachLocation(loci, (location) => {
      if (selected !== null || !Unit.isAtomic(location.unit)) return;
      const authChainId = cleanCifValue(
        StructureProperties.chain.auth_asym_id(location),
      );
      const labelChainId = cleanCifValue(
        StructureProperties.chain.label_asym_id(location),
      );
      selected = {
        chainId: authChainId || labelChainId,
        compId: StructureProperties.residue.label_comp_id(location),
        insertionCode: cleanCifValue(
          StructureProperties.residue.pdbx_PDB_ins_code(location),
        ),
        number: StructureProperties.residue.auth_seq_id(location),
      };
    });
    return selected;
  }

  #structureRef() {
    return this.#plugin.managers.structure.hierarchy.current.structures[0];
  }

  #structureCell() {
    const structureRef = this.#structureRef();
    return structureRef?.transform?.cell ??
      structureRef?.properties?.cell ??
      structureRef?.cell;
  }

  #rootStructure() {
    return this.#structureCell()?.obj?.data;
  }

  #visibleStructure() {
    const root = this.#rootStructure();
    const structureRef = this.#structureRef();
    if (root === undefined || structureRef === undefined) return root;
    const visibleComponents = structureRef.components.flatMap((component) => {
      const structure = component.cell.obj?.data;
      return component.cell.state.isHidden || structure === undefined
        ? []
        : [structure];
    });
    return structureUnion(root, visibleComponents);
  }

  #representationTargets() {
    const components = this.#structureRef()?.components ?? [];
    const isolate = components.filter((component) =>
      hasMolstarTag(component.cell.transform.tags, MolstarComponentTag.isolate),
    );
    if (isolate.length > 0) return isolate;
    return components.filter((component) =>
      hasMolstarTag(component.cell.transform.tags, MolstarComponentTag.polymer),
    );
  }

  #assertLoadGeneration(generation: number): void {
    if (this.#disposed || generation !== this.#loadGeneration) {
      throw abortedError();
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Viewer has been disposed');
  }
}
