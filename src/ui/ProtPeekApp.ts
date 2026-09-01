// SPDX-License-Identifier: MPL-2.0
import { browser } from 'wxt/browser';

import {
  loadStorageKey,
  scanStorageKey,
  type LoadPayload,
  type ScanPayload,
} from '../browser/sessionPayloads';
import {
  PerformanceRecorder,
  sampleAnimationFrames,
} from '../performance/PerformanceRecorder';
import { parseStructureIdentifier } from '../structures/identifiers';
import { LoadCoordinator } from '../structures/loaders/LoadCoordinator';
import { loadAlphaFoldStructure } from '../structures/loaders/alphafold';
import { StructureLoadError, toStructureLoadError } from '../structures/loaders/errors';
import { loadLocalStructure } from '../structures/loaders/local';
import { loadRcsbStructure } from '../structures/loaders/rcsb';
import type { LoadedStructureData, LoadTimings } from '../structures/types';
import { logger } from '../utils/logger';
import { LazyStructureViewer } from '../viewer/LazyStructureViewer';
import type {
  SelectionRepresentation,
  StructureColorMode,
  StructureExport,
  StructureRepresentation,
  StructureViewer,
  ViewerSelection,
} from '../viewer/StructureViewer';
import { button, element, setHidden } from './components/dom';
import { StructurePanel } from './components/StructurePanel';
import { shouldHideEmptyState } from './emptyStateVisibility';

type Loader = (signal: AbortSignal) => Promise<LoadedStructureData>;

export interface ProtPeekAppOptions {
  readonly onArticleRefresh: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  'file-too-large': 'This structure is too large to open safely',
  'invalid-file': 'This file could not be read',
  network: 'The structure service is unavailable',
  'not-found': 'Structure not found',
  'unsupported-file': 'Unsupported structure file',
  'webgl-unavailable': 'WebGL is unavailable',
};

export class ProtPeekApp {
  readonly #root: HTMLElement;
  readonly #viewerHost = element('div', { className: 'viewer-host' });
  readonly #viewerFrame = element('section', { className: 'viewer-frame' });
  readonly #emptyState = element('div', { className: 'empty-state' });
  readonly #dropOverlay = element('div', {
    className: 'drop-overlay',
    text: 'Drop structure',
  });
  readonly #status = element('div', { className: 'load-status' });
  readonly #hoverLabel = element('div', { className: 'hover-label' });
  readonly #errorBox = element('div', { className: 'error-box' });
  readonly #errorText = element('span');
  readonly #retryButton = button('Retry', { className: 'text-button' });
  readonly #cancelButton = button('Cancel', { className: 'text-button' });
  readonly #resetButton = button('Reset view', {
    className: 'viewer-button',
    title: 'Reset view',
  });
  readonly #downloadButton = button('↓', {
    className: 'viewer-button download-button',
    title: 'Download structure (PDBx/mmCIF)',
  });
  readonly #identifierInput = element('input', { className: 'identifier-input' });
  readonly #articleRefreshButton = button('↻', {
    className: 'article-refresh-button',
    title: 'Refresh structures on this page',
  });
  readonly #fileInput = element('input', { className: 'visually-hidden' });
  readonly #fileButton = button('Choose file', { className: 'text-button empty-file-button' });
  readonly #articleBar = element('section', { className: 'article-bar' });
  readonly #articleItems = element('div', { className: 'article-items' });
  readonly #coordinator = new LoadCoordinator();
  readonly #benchmarkEnabled =
    import.meta.env.DEV || new URL(location.href).searchParams.has('benchmark');
  readonly #performance = new PerformanceRecorder();
  readonly #viewer: LazyStructureViewer;
  readonly #panel: StructurePanel;
  readonly #resizeObserver: ResizeObserver;
  readonly #themeQuery = matchMedia('(prefers-color-scheme: dark)');
  readonly #themeListener = ({ matches }: MediaQueryListEvent): void => {
    void this.#viewer
      .withViewer((viewer) => viewer.setTheme(matches))
      .catch((error: unknown) => logger.warn('Theme update failed', error));
  };
  #disposed = false;
  #dragDepth = 0;
  #hasStructure = false;
  #activeArticleTabId: number | undefined;
  #lastLoad: (() => Promise<void>) | undefined;
  #loadGeneration = 0;
  #viewerActionGeneration = 0;
  #viewerActionQueue: Promise<void> = Promise.resolve();
  #storageListener:
    | Parameters<typeof browser.storage.onChanged.addListener>[0]
    | undefined;
  #windowId: number | undefined;

  constructor(root: HTMLElement, options: ProtPeekAppOptions) {
    this.#root = root;
    this.#viewer = new LazyStructureViewer(this.#viewerHost, {
      onContextLost: () => this.#showError('WebGL context was lost. Waiting for recovery…', false),
      onContextRestored: () => this.#clearError(),
      onHover: (residue) => {
        this.#hoverLabel.textContent = residue === null
          ? ''
          : `Chain ${residue.chainId} · ${residue.compId} ${residue.number}${residue.insertionCode}`;
        setHidden(this.#hoverLabel, residue === null);
      },
      onSelection: (residue) => this.#panel.highlightResidue(residue),
    });
    this.#panel = new StructurePanel({
      onChainVisible: (chainId, visible) => this.#chainVisible(chainId, visible),
      onColorMode: (mode) => this.#colorMode(mode),
      onColorSelection: (color) => this.#colorSelection(color),
      onFocusSelection: () => this.#focusSelection(),
      onIsolate: (selection) => this.#isolate(selection),
      onRepresentation: (representation) => this.#representation(representation),
      onResetView: () => this.#resetView(),
      onSelect: (selection, focus) => this.#select(selection, focus),
      onSelectionRepresentation: (representation) =>
        this.#selectionRepresentation(representation),
      onShowAll: () => this.#showAll(),
    });
    this.#articleRefreshButton.setAttribute(
      'aria-label',
      'Refresh structures on this page',
    );
    this.#articleRefreshButton.addEventListener(
      'click',
      options.onArticleRefresh,
    );

    this.#build();
    this.#bind();
    if (this.#benchmarkEnabled) {
      Object.assign(globalThis, {
        __PROTPEEK_BENCHMARK__: {
          loads: () => this.#performance.records(),
          sampleFps: (durationMs?: number) => sampleAnimationFrames(durationMs),
        },
      });
    }
    this.#resizeObserver = new ResizeObserver(() => this.#viewer.resize());
    this.#resizeObserver.observe(this.#viewerFrame);
  }

  async initialize(): Promise<void> {
    try {
      const currentWindow = await browser.windows.getCurrent();
      this.#windowId = currentWindow.id;
      if (this.#windowId === undefined) return;
      await this.#readSessionPayloads();
    } catch (error) {
      logger.warn('Could not initialize session integration', error);
    }
  }

  /** Clears cross-tab results and rejects any late payload from the old tab. */
  activateArticleTab(tabId: number): void {
    this.#activeArticleTabId = tabId;
    this.#articleItems.replaceChildren();
    setHidden(this.#articleBar, true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#coordinator.cancel();
    this.#viewer.dispose();
    this.#panel.dispose();
    this.#resizeObserver.disconnect();
    this.#themeQuery.removeEventListener('change', this.#themeListener);
    if (this.#storageListener !== undefined) {
      browser.storage.onChanged.removeListener(this.#storageListener);
    }
  }

  #build(): void {
    const brand = element('span', { className: 'brand', text: 'ProtPeek' });
    const form = element('form', { className: 'identifier-form' });
    this.#identifierInput.type = 'text';
    this.#identifierInput.placeholder = 'PDB / UniProt / AlphaFold';
    this.#identifierInput.autocomplete = 'off';
    this.#identifierInput.spellcheck = false;
    this.#identifierInput.setAttribute('aria-label', 'PDB, UniProt, or AlphaFold identifier');
    const openButton = button('Open', { className: 'load-button' });
    openButton.type = 'submit';
    form.append(this.#identifierInput, openButton);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#loadIdentifier(this.#identifierInput.value);
    });

    const header = element('header', { className: 'topbar' }, [
      brand,
      form,
      this.#articleRefreshButton,
    ]);
    this.#articleBar.setAttribute('aria-label', 'Structures on this page');
    this.#articleBar.append(
      element('span', { className: 'article-label', text: 'On this page' }),
      this.#articleItems,
    );
    setHidden(this.#articleBar, true);

    this.#emptyState.append(
      element('p', { className: 'empty-title', text: 'Drop a structure' }),
      element('p', {
        className: 'empty-formats',
        text: '.cif · .mmcif · .bcif · .pdb',
      }),
      this.#fileButton,
      this.#fileInput,
    );
    this.#fileInput.type = 'file';
    this.#fileInput.accept = '.cif,.mmcif,.bcif,.pdb';
    this.#fileButton.addEventListener('click', () => this.#fileInput.click());
    this.#fileInput.addEventListener('change', () => {
      const file = this.#fileInput.files?.[0];
      this.#fileInput.value = '';
      if (file !== undefined) void this.#loadFile(file);
    });
    this.#status.setAttribute('role', 'status');
    this.#status.setAttribute('aria-live', 'polite');
    this.#errorBox.setAttribute('role', 'alert');
    this.#retryButton.addEventListener('click', () => void this.#lastLoad?.());
    this.#errorBox.append(this.#errorText, this.#retryButton);
    this.#cancelButton.addEventListener('click', () => this.#cancelTask());
    this.#resetButton.addEventListener('click', () => {
      this.#panel.resetViewState();
      this.#resetView();
    });
    this.#downloadButton.setAttribute(
      'aria-label',
      'Download structure as PDBx/mmCIF',
    );
    this.#downloadButton.addEventListener('click', () => {
      void this.#downloadStructure();
    });

    setHidden(this.#dropOverlay, true);
    setHidden(this.#hoverLabel, true);
    setHidden(this.#errorBox, true);
    setHidden(this.#cancelButton, true);
    setHidden(this.#resetButton, true);
    setHidden(this.#downloadButton, true);
    this.#viewerFrame.setAttribute('aria-label', 'Protein structure viewer');

    const viewerActions = element('div', { className: 'viewer-actions' }, [
      this.#downloadButton,
      this.#resetButton,
    ]);
    const statusLine = element('div', { className: 'status-line' }, [
      this.#status,
      this.#cancelButton,
    ]);
    this.#viewerFrame.append(
      this.#viewerHost,
      this.#emptyState,
      this.#dropOverlay,
      statusLine,
      this.#errorBox,
      this.#hoverLabel,
      viewerActions,
    );

    const shell = element('main', { className: 'protpeek-app' }, [
      header,
      this.#articleBar,
      this.#viewerFrame,
      this.#panel.customizationPanel,
    ]);
    this.#root.replaceChildren(shell);
  }

  #bind(): void {
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'] as const) {
      this.#viewerFrame.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    this.#viewerFrame.addEventListener('dragenter', () => {
      this.#dragDepth += 1;
      setHidden(this.#dropOverlay, false);
    });
    this.#viewerFrame.addEventListener('dragleave', () => {
      this.#dragDepth = Math.max(0, this.#dragDepth - 1);
      if (this.#dragDepth === 0) setHidden(this.#dropOverlay, true);
    });
    this.#viewerFrame.addEventListener('drop', (event) => {
      this.#dragDepth = 0;
      setHidden(this.#dropOverlay, true);
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) void this.#loadFile(file);
    });

    this.#themeQuery.addEventListener('change', this.#themeListener);

    this.#storageListener = (changes, areaName) => {
      if (areaName !== 'session' || this.#windowId === undefined) return;
      const scan = changes[scanStorageKey(this.#windowId)]?.newValue;
      if (this.#isScanPayload(scan)) this.#renderArticleStructures(scan);
      const load = changes[loadStorageKey(this.#windowId)]?.newValue;
      if (this.#isLoadPayload(load)) {
        void this.#consumeLoadPayload(load);
      }
    };
    browser.storage.onChanged.addListener(this.#storageListener);
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
  }

  async #loadIdentifier(input: string): Promise<void> {
    const identifier = parseStructureIdentifier(input);
    if (identifier === null) {
      this.#showError('Enter a valid PDB, UniProt, or AlphaFold identifier', false);
      return;
    }
    this.#identifierInput.value = identifier.displayValue;
    const loader: Loader =
      identifier.type === 'pdb'
        ? (signal) => loadRcsbStructure(identifier.canonicalValue, signal)
        : (signal) => loadAlphaFoldStructure(identifier.canonicalValue, signal);
    await this.#beginLoad(`Loading ${identifier.displayValue}…`, loader);
  }

  async #loadFile(file: File): Promise<void> {
    await this.#beginLoad(`Loading ${file.name}…`, (signal) =>
      loadLocalStructure(file, signal),
    );
  }

  async #beginLoad(label: string, loader: Loader): Promise<void> {
    const generation = ++this.#loadGeneration;
    this.#viewerActionGeneration += 1;
    const replacing = this.#hasStructure;
    const totalStartedAt = performance.now();
    this.#lastLoad = () => this.#beginLoad(label, loader);
    this.#clearError();
    this.#status.textContent = label;
    this.#syncEmptyState(true);
    this.#panel.setBusy(true);
    setHidden(this.#cancelButton, false);
    this.#downloadButton.disabled = true;
    this.#resetButton.disabled = true;
    void this.#viewer
      .withViewer((viewer) => viewer.cancelCurrentTask())
      .catch((error: unknown) => logger.warn('Could not cancel the previous viewer task', error));

    try {
      const result = await this.#coordinator.run(async (signal) => {
        const acquisitionStartedAt = performance.now();
        const acquisition = loader(signal).then((loaded) => ({
          acquisitionMs: performance.now() - acquisitionStartedAt,
          loaded,
        }));
        const [, { acquisitionMs, loaded }] = await Promise.all([
          this.#viewer.prepare(),
          acquisition,
        ]);
        await this.#viewerActionQueue;
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        this.#panel.clear();
        this.#hasStructure = false;
        this.#syncEmptyState(true);
        setHidden(this.#resetButton, true);
        setHidden(this.#downloadButton, true);
        const viewerResult = await this.#viewer.load(loaded);
        return {
          ...viewerResult,
          timings: {
            ...viewerResult.timings,
            acquisitionMs,
            totalMs: performance.now() - totalStartedAt,
          },
        };
      });
      if (generation !== this.#loadGeneration) return;
      this.#panel.setMetadata(result.metadata);
      this.#hasStructure = true;
      this.#syncEmptyState(false);
      this.#status.textContent = '';
      setHidden(this.#resetButton, false);
      setHidden(this.#downloadButton, false);
      this.#lastLoad = undefined;
      this.#recordPerformance(
        label,
        result.metadata.atomCount,
        replacing,
        result.timings,
      );
    } catch (error) {
      if (generation !== this.#loadGeneration) return;
      const loadError = toStructureLoadError(error);
      if (loadError.code !== 'aborted') {
        this.#showError(ERROR_MESSAGES[loadError.code] ?? 'The structure could not be opened');
      }
      this.#syncEmptyState(false);
    } finally {
      if (generation === this.#loadGeneration) {
        setHidden(this.#cancelButton, true);
        this.#panel.setBusy(false);
        this.#downloadButton.disabled = !this.#hasStructure;
        this.#resetButton.disabled = !this.#hasStructure;
      }
    }
  }

  #cancelTask(): void {
    this.#loadGeneration += 1;
    this.#viewerActionGeneration += 1;
    this.#coordinator.cancel();
    void this.#viewer
      .withViewer((viewer) => viewer.cancelCurrentTask())
      .catch((error: unknown) => logger.warn('Could not cancel the viewer task', error));
    this.#status.textContent = '';
    this.#syncEmptyState(false);
    this.#panel.setBusy(false);
    setHidden(this.#cancelButton, true);
    this.#downloadButton.disabled = !this.#hasStructure;
    this.#resetButton.disabled = !this.#hasStructure;
  }

  #select(selection: ViewerSelection, focus: boolean): void {
    void this.#runViewerAction(
      undefined,
      'The selection could not be applied',
      (viewer) => {
        viewer.select(selection);
        if (focus) viewer.focusSelection();
      },
    );
  }

  #focusSelection(): void {
    void this.#runViewerAction(
      undefined,
      'The selection could not be focused',
      (viewer) => viewer.focusSelection(),
    );
  }

  #resetView(): void {
    void this.#runViewerAction(
      undefined,
      'The camera could not be reset',
      (viewer) => viewer.resetCamera(),
    );
  }

  async #chainVisible(chainId: string, visible: boolean): Promise<boolean> {
    return await this.#runViewerAction(
      visible ? `Showing chain ${chainId}…` : `Hiding chain ${chainId}…`,
      `Chain ${chainId} visibility could not be changed`,
      (viewer) => viewer.setChainVisible(chainId, visible),
    );
  }

  async #isolate(selection: ViewerSelection): Promise<boolean> {
    return await this.#runViewerAction(
      'Isolating selection…',
      'The selection could not be isolated',
      (viewer) => viewer.isolate(selection),
    );
  }

  async #showAll(): Promise<boolean> {
    return await this.#runViewerAction(
      'Restoring structure…',
      'The structure could not be restored',
      async (viewer) => {
        await viewer.showAll();
        viewer.resetCamera();
      },
    );
  }

  async #representation(
    representation: StructureRepresentation,
  ): Promise<boolean> {
    const isSurface = representation === 'surface';
    if (isSurface) {
      setHidden(this.#cancelButton, false);
    }
    try {
      return await this.#runViewerAction(
        isSurface ? 'Computing surface…' : undefined,
        'The representation could not be created',
        (viewer) => viewer.setRepresentation(representation),
      );
    } finally {
      if (isSurface) {
        setHidden(this.#cancelButton, true);
      }
    }
  }

  async #colorMode(mode: StructureColorMode): Promise<boolean> {
    return await this.#runViewerAction(
      undefined,
      'The color scheme could not be changed',
      (viewer) => viewer.setColorMode(mode),
    );
  }

  async #colorSelection(color: number | null): Promise<boolean> {
    return await this.#runViewerAction(
      undefined,
      'The selection could not be colored',
      (viewer) => viewer.colorSelection(color),
    );
  }

  async #selectionRepresentation(
    representation: SelectionRepresentation,
  ): Promise<boolean> {
    return await this.#runViewerAction(
      representation === 'highlight' ? undefined : 'Updating selection…',
      'The selected-residue style could not be changed',
      (viewer) => viewer.setSelectionRepresentation(representation),
    );
  }

  async #downloadStructure(): Promise<void> {
    if (!this.#hasStructure || this.#downloadButton.disabled) return;
    this.#downloadButton.disabled = true;
    let exported: StructureExport | undefined;
    try {
      const completed = await this.#runViewerAction(
        'Preparing download…',
        'The structure could not be downloaded',
        async (viewer) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          exported = viewer.exportCurrentStructure();
        },
      );
      if (!completed || exported === undefined) return;

      const url = URL.createObjectURL(
        new Blob([exported.text], { type: exported.mimeType }),
      );
      const anchor = element('a');
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } finally {
      this.#downloadButton.disabled = !this.#hasStructure;
    }
  }

  async #runViewerAction(
    status: string | undefined,
    errorMessage: string,
    operation: (viewer: StructureViewer) => void | Promise<void>,
  ): Promise<boolean> {
    const generation = this.#viewerActionGeneration;
    const task = this.#viewerActionQueue.then(async () => {
      if (generation !== this.#viewerActionGeneration) {
        throw new StructureLoadError('aborted', 'Action was superseded');
      }
      if (status !== undefined) this.#status.textContent = status;
      await this.#viewer.withViewer(operation);
    });
    this.#viewerActionQueue = task.catch(() => undefined);
    try {
      await task;
      return true;
    } catch (error) {
      if (!(error instanceof StructureLoadError && error.code === 'aborted')) {
        this.#showError(errorMessage, false);
        logger.warn(errorMessage, error);
      }
      return false;
    } finally {
      if (status !== undefined && this.#status.textContent === status) {
        this.#status.textContent = '';
      }
    }
  }

  #showError(message: string, retry = true): void {
    this.#errorText.textContent = message;
    setHidden(this.#retryButton, !retry || this.#lastLoad === undefined);
    setHidden(this.#errorBox, false);
  }

  #clearError(): void {
    this.#errorText.textContent = '';
    setHidden(this.#errorBox, true);
  }

  #syncEmptyState(loading: boolean): void {
    setHidden(
      this.#emptyState,
      shouldHideEmptyState(this.#hasStructure, loading),
    );
  }

  async #readSessionPayloads(): Promise<void> {
    const windowId = this.#windowId;
    if (windowId === undefined) return;
    const scanKey = scanStorageKey(windowId);
    const loadKey = loadStorageKey(windowId);
    const values = await browser.storage.session.get([scanKey, loadKey]);
    const scan = values[scanKey];
    if (this.#isScanPayload(scan)) this.#renderArticleStructures(scan);
    const load = values[loadKey];
    if (this.#isLoadPayload(load)) await this.#consumeLoadPayload(load);
  }

  #renderArticleStructures(payload: ScanPayload): void {
    if (
      this.#activeArticleTabId !== undefined &&
      payload.tabId !== this.#activeArticleTabId
    ) {
      return;
    }
    this.#articleItems.replaceChildren();
    for (const structure of payload.structures) {
      const chip = button(structure.displayId, { className: 'article-chip' });
      chip.addEventListener('click', () => void this.#loadIdentifier(structure.id));
      this.#articleItems.append(chip);
    }
    if (payload.error !== undefined) {
      this.#articleItems.append(
        element('span', { className: 'scan-note', text: payload.error }),
      );
    }
    setHidden(
      this.#articleBar,
      payload.structures.length === 0 && payload.error === undefined,
    );
  }

  async #consumeLoadPayload(payload: LoadPayload): Promise<void> {
    const windowId = this.#windowId;
    if (windowId !== undefined) {
      await browser.storage.session.remove(loadStorageKey(windowId));
    }
    await this.#loadIdentifier(payload.identifier);
  }

  #isScanPayload(value: unknown): value is ScanPayload {
    return (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as { structures?: unknown }).structures) &&
      typeof (value as { tabId?: unknown }).tabId === 'number'
    );
  }

  #isLoadPayload(value: unknown): value is LoadPayload {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { identifier?: unknown }).identifier === 'string'
    );
  }

  #recordPerformance(
    label: string,
    atomCount: number,
    replacing: boolean,
    timings: LoadTimings,
  ): void {
    if (!this.#benchmarkEnabled) return;
    const record = this.#performance.record(label, atomCount, replacing, timings);
    Object.assign(globalThis, { __PROTPEEK_LAST_TIMINGS__: record });
  }
}
