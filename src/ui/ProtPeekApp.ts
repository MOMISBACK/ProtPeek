// SPDX-License-Identifier: MPL-2.0
import { browser } from 'wxt/browser';

import {
  loadStorageKey,
  scanStorageKey,
  type LoadPayload,
  type ScanPayload,
} from '../browser/sessionPayloads';
import { sidePanelTabActivatedMessage } from '../browser/sidePanelSession';
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
  StructureImageExport,
  StructureRepresentation,
  StructureViewer,
  ViewerSelection,
  ViewerBackground,
} from '../viewer/StructureViewer';
import { button, element, setHidden } from './components/dom';
import { StructurePanel } from './components/StructurePanel';
import { pageScanPresentation } from './pageScanPresentation';
import { ViewerBackgroundPreference } from './viewerBackgroundPreference';

type Loader = (signal: AbortSignal) => Promise<LoadedStructureData>;
type PanelSection = 'open' | 'page';

const ERROR_MESSAGES: Record<string, string> = {
  'file-too-large': 'This structure is too large to open safely',
  'invalid-file': 'This file could not be read',
  network: 'The structure service is unavailable',
  'not-found': 'Structure not found',
  'unsupported-file': 'Unsupported structure file',
  'webgl-unavailable': 'WebGL is unavailable',
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function actionIcon(
  label: string,
  className: string,
  paths: readonly string[],
): HTMLButtonElement {
  const action = button('', { className, title: label });
  action.setAttribute('aria-label', label);
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('class', 'action-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  for (const pathData of paths) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', pathData);
    icon.append(path);
  }
  action.append(icon);
  return action;
}

export class ProtPeekApp {
  readonly #root: HTMLElement;
  readonly #viewerHost = element('div', { className: 'viewer-host' });
  readonly #viewerFrame = element('section', { className: 'viewer-frame' });
  readonly #viewerWorkspace = element('section', {
    className: 'viewer-workspace',
  });
  readonly #pageView = element('section', { className: 'app-page page-view' });
  readonly #openView = element('section', { className: 'app-page open-view' });
  readonly #pageHero = element('div', { className: 'page-hero' });
  readonly #pageStatus = element('div', { className: 'page-scan-status' });
  readonly #pageResults = element('div', { className: 'page-results' });
  readonly #pageResultsHeading = element('div', {
    className: 'page-section-title results-heading',
  });
  readonly #pageScanButton = button('↻', {
    className: 'scan-button',
    title: 'Scan this page again',
  });
  readonly #viewerScanButton = button('↻', {
    className: 'scan-button compact-scan-button',
    title: 'Scan this page again',
  });
  readonly #viewerDetectedBar = element('section', {
    className: 'viewer-detected-bar',
  });
  readonly #viewerDetectedItems = element('div', {
    className: 'viewer-detected-items',
  });
  readonly #openError = element('p', { className: 'open-error' });
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
  readonly #downloadButton = actionIcon(
    'Download structure file as PDBx/mmCIF',
    'viewer-button download-button',
    ['M12 3v11', 'M7 10l5 5 5-5', 'M5 18v3h14v-3'],
  );
  readonly #imageButton = actionIcon(
    'Download current view as PNG',
    'viewer-button image-button',
    ['M4 7h4l1.5-2h5L16 7h4v12H4z', 'M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
  );
  readonly #identifierInput = element('input', { className: 'identifier-input' });
  readonly #fileInput = element('input', { className: 'visually-hidden' });
  readonly #dropZone = button('', {
    className: 'dropzone',
  });
  readonly #pageTab = button('Page', { className: 'nav-tab' });
  readonly #openTab = button('Open', { className: 'nav-tab' });
  readonly #header = element('header', { className: 'topbar' });
  readonly #viewStructureButton = button('View structure', {
    className: 'header-action',
  });
  readonly #coordinator = new LoadCoordinator();
  readonly #benchmarkEnabled =
    import.meta.env.DEV || new URL(location.href).searchParams.has('benchmark');
  readonly #performance = new PerformanceRecorder();
  readonly #viewer: LazyStructureViewer;
  readonly #panel: StructurePanel;
  readonly #resizeObserver: ResizeObserver;
  readonly #backgroundPreference: ViewerBackgroundPreference;
  #disposed = false;
  #activeArticleTabId: number | undefined;
  #activeIdentifierKey: string | undefined;
  #dragDepth = 0;
  #hasStructure = false;
  #activeSection: PanelSection = 'page';
  #lastLoad: (() => Promise<void>) | undefined;
  #loadGeneration = 0;
  #viewerActionGeneration = 0;
  #viewerActionQueue: Promise<void> = Promise.resolve();
  #storageListener:
    | Parameters<typeof browser.storage.onChanged.addListener>[0]
    | undefined;
  #windowId: number | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#backgroundPreference = new ViewerBackgroundPreference(browser.storage.local);
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
      onBackground: (background) => this.#setBackground(background),
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
      const background = await this.#backgroundPreference.read();
      if (!this.#disposed) this.#applyBackground(background);
    } catch (error) {
      logger.warn('Could not read the viewer background preference', error);
    }
    try {
      const currentWindow = await browser.windows.getCurrent();
      this.#windowId = currentWindow.id;
      if (this.#windowId === undefined) return;
      await this.#readSessionPayloads();
    } catch (error) {
      logger.warn('Could not initialize session integration', error);
    }
  }

  /** Clears cross-tab detections and rejects late scan results from the old tab. */
  activateArticleTab(tabId: number): void {
    if (this.#activeArticleTabId === tabId) return;
    this.#activeArticleTabId = tabId;
    this.#pageResults.replaceChildren(this.#pageResultsHeading);
    this.#viewerDetectedItems.replaceChildren();
    this.#pageStatus.textContent = 'Scanning this page…';
    setHidden(this.#pageHero, false);
    setHidden(this.#pageResults, true);
    setHidden(this.#viewerDetectedBar, true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#coordinator.cancel();
    this.#viewer.dispose();
    this.#panel.dispose();
    this.#resizeObserver.disconnect();
    if (this.#storageListener !== undefined) {
      browser.storage.onChanged.removeListener(this.#storageListener);
    }
  }

  #build(): void {
    setHidden(this.#viewStructureButton, true);
    this.#header.append(this.#viewStructureButton);
    setHidden(this.#header, true);

    const initialScan = pageScanPresentation(null);
    this.#pageHero.append(
      element('h1', { className: 'page-title' }, [
        document.createTextNode('Read the paper.'),
        element('br'),
        document.createTextNode('See the structure.'),
      ]),
      element('p', {
        className: 'page-subtitle',
        text: "Find protein structures mentioned on the page you're reading.",
      }),
      this.#pageStatus,
    );
    this.#pageStatus.textContent = initialScan.status;
    this.#pageStatus.setAttribute('role', 'status');
    this.#pageStatus.setAttribute('aria-live', 'polite');
    this.#pageResults.append(this.#pageResultsHeading);
    setHidden(this.#pageResults, true);
    for (const scanButton of [this.#pageScanButton, this.#viewerScanButton]) {
      scanButton.setAttribute('aria-label', 'Scan this page again');
    }
    this.#pageView.id = 'page-panel';
    this.#pageView.setAttribute('role', 'tabpanel');
    this.#pageView.setAttribute('aria-labelledby', 'page-tab');
    this.#pageView.append(
      element('div', { className: 'page-heading' }, [
        element('div', { className: 'page-section-title', text: 'THIS PAGE' }),
        this.#pageScanButton,
      ]),
      this.#pageHero,
      this.#pageResults,
    );

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

    this.#fileInput.type = 'file';
    this.#fileInput.accept = '.cif,.mmcif,.bcif,.pdb';
    this.#dropZone.append(
      element('strong', {
        className: 'dropzone-title',
        text: 'Drop a structure file here',
      }),
      element('span', { className: 'dropzone-choice' }, [
        document.createTextNode('or '),
        element('span', {
          className: 'dropzone-choose',
          text: 'choose a local file',
        }),
      ]),
      element('span', {
        className: 'dropzone-formats',
        text: 'PDB · CIF · mmCIF · BCIF',
      }),
    );
    this.#openError.setAttribute('role', 'alert');
    this.#openView.id = 'open-panel';
    this.#openView.setAttribute('role', 'tabpanel');
    this.#openView.setAttribute('aria-labelledby', 'open-tab');
    this.#openView.append(
      element('div', { className: 'page-section-title', text: 'OPEN A STRUCTURE' }),
      element('div', { className: 'open-content' }, [
        form,
        this.#openError,
        element('div', { className: 'open-divider', text: 'or' }),
        this.#dropZone,
        this.#fileInput,
      ]),
    );

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
      'Download structure file as PDBx/mmCIF',
    );
    this.#downloadButton.addEventListener('click', () => {
      void this.#downloadStructure();
    });
    this.#imageButton.addEventListener('click', () => {
      void this.#downloadImage();
    });

    setHidden(this.#dropOverlay, true);
    setHidden(this.#hoverLabel, true);
    setHidden(this.#errorBox, true);
    setHidden(this.#cancelButton, true);
    setHidden(this.#resetButton, true);
    setHidden(this.#downloadButton, true);
    setHidden(this.#imageButton, true);
    this.#viewerFrame.setAttribute('aria-label', 'Protein structure viewer');

    const viewerActions = element('div', { className: 'viewer-actions' }, [
      this.#downloadButton,
      this.#imageButton,
      this.#resetButton,
    ]);
    const statusLine = element('div', { className: 'status-line' }, [
      this.#status,
      this.#cancelButton,
    ]);
    this.#viewerFrame.append(
      this.#viewerHost,
      this.#dropOverlay,
      statusLine,
      this.#errorBox,
      this.#hoverLabel,
      viewerActions,
    );

    this.#viewerDetectedBar.setAttribute(
      'aria-label',
      'Structures detected on this page',
    );
    this.#viewerDetectedBar.append(
      element('span', { className: 'viewer-detected-label', text: 'THIS PAGE' }),
      this.#viewerDetectedItems,
      this.#viewerScanButton,
    );
    setHidden(this.#viewerDetectedBar, true);
    this.#viewerWorkspace.append(
      this.#viewerDetectedBar,
      this.#viewerFrame,
      this.#panel.inspector,
    );
    setHidden(this.#viewerWorkspace, true);

    this.#pageTab.id = 'page-tab';
    this.#pageTab.dataset.section = 'page';
    this.#pageTab.setAttribute('role', 'tab');
    this.#pageTab.setAttribute('aria-controls', 'page-panel');
    this.#openTab.id = 'open-tab';
    this.#openTab.dataset.section = 'open';
    this.#openTab.setAttribute('role', 'tab');
    this.#openTab.setAttribute('aria-controls', 'open-panel');
    const navigation = element('nav', { className: 'bottom-nav' }, [
      this.#pageTab,
      this.#openTab,
    ]);
    navigation.setAttribute('aria-label', 'ProtPeek sections');
    navigation.setAttribute('role', 'tablist');

    const shell = element('main', { className: 'protpeek-app' }, [
      this.#header,
      this.#pageView,
      this.#openView,
      this.#viewerWorkspace,
      navigation,
    ]);
    this.#root.replaceChildren(shell);
    this.#showSection('page');
  }

  #showSection(section: PanelSection): void {
    this.#activeSection = section;
    setHidden(this.#pageView, section !== 'page');
    setHidden(this.#openView, section !== 'open');
    setHidden(this.#viewerWorkspace, true);
    for (const [tab, tabSection] of [
      [this.#pageTab, 'page'],
      [this.#openTab, 'open'],
    ] as const) {
      const active = tabSection === section;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    setHidden(this.#viewStructureButton, !this.#hasStructure);
    setHidden(this.#header, !this.#hasStructure);
  }

  #showViewer(): void {
    setHidden(this.#pageView, true);
    setHidden(this.#openView, true);
    setHidden(this.#viewerWorkspace, false);
    setHidden(this.#viewStructureButton, true);
    setHidden(this.#header, true);
    requestAnimationFrame(() => this.#viewer.resize());
  }

  #setNavigationBusy(busy: boolean): void {
    this.#pageTab.disabled = busy;
    this.#openTab.disabled = busy;
  }

  #bind(): void {
    for (const scanButton of [this.#pageScanButton, this.#viewerScanButton]) {
      scanButton.addEventListener('click', () => {
        void this.#refreshPageScan();
      });
    }
    this.#pageTab.addEventListener('click', () => this.#showSection('page'));
    this.#openTab.addEventListener('click', () => this.#showSection('open'));
    for (const tab of [this.#pageTab, this.#openTab]) {
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const next =
          event.key === 'ArrowLeft' || event.key === 'Home'
            ? this.#pageTab
            : this.#openTab;
        this.#showSection(next === this.#pageTab ? 'page' : 'open');
        next.focus();
      });
    }
    this.#viewStructureButton.addEventListener('click', () => this.#showViewer());
    this.#dropZone.addEventListener('click', () => this.#fileInput.click());
    this.#fileInput.addEventListener('change', () => {
      const file = this.#fileInput.files?.[0];
      this.#fileInput.value = '';
      if (file !== undefined) void this.#loadFile(file);
    });
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'] as const) {
      this.#dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    for (const type of ['dragenter', 'dragover'] as const) {
      this.#dropZone.addEventListener(type, () => {
        this.#dropZone.classList.add('is-dragover');
      });
    }
    this.#dropZone.addEventListener('dragleave', () => {
      this.#dropZone.classList.remove('is-dragover');
    });
    this.#dropZone.addEventListener('drop', (event) => {
      this.#dropZone.classList.remove('is-dragover');
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) void this.#loadFile(file);
    });

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

  #applyBackground(background: ViewerBackground): void {
    this.#panel.setBackground(background);
    this.#viewerHost.style.backgroundColor = background === 'black' ? '#000000' : '#ffffff';
    void this.#viewer.setBackground(background)
      .catch((error: unknown) => logger.warn('Could not update the viewer background', error));
  }

  #setBackground(background: ViewerBackground): void {
    this.#applyBackground(background);
    void this.#backgroundPreference.set(background)
      .catch((error: unknown) => logger.warn('Could not save the viewer background preference', error));
  }

  async #refreshPageScan(): Promise<void> {
    if (this.#windowId === undefined || this.#pageScanButton.disabled) return;
    this.#setScanBusy(true);
    if (this.#pageResults.hidden) {
      this.#pageStatus.textContent = 'Scanning this page…';
    }
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        windowId: this.#windowId,
      });
      if (activeTab?.id === undefined) {
        throw new Error('No active tab is available');
      }
      const response: unknown = await browser.runtime.sendMessage(
        sidePanelTabActivatedMessage(activeTab.id, this.#windowId),
      );
      if (
        typeof response !== 'object' ||
        response === null ||
        (response as { refreshed?: unknown }).refreshed !== true
      ) {
        throw new Error('The active tab could not be scanned');
      }
    } catch (error) {
      if (this.#pageResults.hidden) {
        this.#pageStatus.textContent = 'This page could not be scanned.';
      }
      logger.warn('Could not rescan the active page', error);
    } finally {
      this.#setScanBusy(false);
    }
  }

  #setScanBusy(busy: boolean): void {
    for (const scanButton of [this.#pageScanButton, this.#viewerScanButton]) {
      scanButton.disabled = busy;
      scanButton.classList.toggle('is-scanning', busy);
      scanButton.title = busy ? 'Scanning this page…' : 'Scan this page again';
      scanButton.setAttribute(
        'aria-label',
        busy ? 'Scanning this page' : 'Scan this page again',
      );
    }
  }

  async #loadIdentifier(input: string): Promise<void> {
    const identifier = parseStructureIdentifier(input);
    if (identifier === null) {
      this.#openError.textContent =
        'Enter a valid PDB, UniProt, or AlphaFold identifier.';
      this.#showSection('open');
      return;
    }
    this.#openError.textContent = '';
    this.#identifierInput.value = identifier.displayValue;
    const loader: Loader =
      identifier.type === 'pdb'
        ? (signal) => loadRcsbStructure(identifier.canonicalValue, signal)
        : (signal) => loadAlphaFoldStructure(identifier.canonicalValue, signal);
    await this.#beginLoad(
      `Loading ${identifier.displayValue}…`,
      loader,
      `${identifier.type}:${identifier.canonicalValue}`,
    );
  }

  async #loadFile(file: File): Promise<void> {
    this.#openError.textContent = '';
    await this.#beginLoad(`Loading ${file.name}…`, (signal) =>
      loadLocalStructure(file, signal),
    );
  }

  async #beginLoad(
    label: string,
    loader: Loader,
    identifierKey?: string,
  ): Promise<void> {
    const generation = ++this.#loadGeneration;
    this.#viewerActionGeneration += 1;
    const replacing = this.#hasStructure;
    const totalStartedAt = performance.now();
    this.#lastLoad = () => this.#beginLoad(label, loader, identifierKey);
    this.#clearError();
    this.#status.textContent = label;
    this.#showViewer();
    this.#setNavigationBusy(true);
    this.#panel.setBusy(true);
    setHidden(this.#cancelButton, false);
    this.#downloadButton.disabled = true;
    this.#imageButton.disabled = true;
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
        setHidden(this.#resetButton, true);
        setHidden(this.#downloadButton, true);
        setHidden(this.#imageButton, true);
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
      this.#activeIdentifierKey = identifierKey;
      this.#syncDetectedActiveState();
      this.#status.textContent = '';
      setHidden(this.#resetButton, false);
      setHidden(this.#downloadButton, false);
      setHidden(this.#imageButton, false);
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
    } finally {
      if (generation === this.#loadGeneration) {
        setHidden(this.#cancelButton, true);
        this.#panel.setBusy(false);
        this.#downloadButton.disabled = !this.#hasStructure;
        this.#imageButton.disabled = !this.#hasStructure;
        this.#resetButton.disabled = !this.#hasStructure;
        this.#setNavigationBusy(false);
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
    this.#panel.setBusy(false);
    setHidden(this.#cancelButton, true);
    this.#downloadButton.disabled = !this.#hasStructure;
    this.#imageButton.disabled = !this.#hasStructure;
    this.#resetButton.disabled = !this.#hasStructure;
    this.#setNavigationBusy(false);
    if (!this.#hasStructure) this.#showSection(this.#activeSection);
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

  async #downloadImage(): Promise<void> {
    if (!this.#hasStructure || this.#imageButton.disabled) return;
    this.#imageButton.disabled = true;
    let exported: StructureImageExport | undefined;
    try {
      const completed = await this.#runViewerAction(
        'Preparing image…',
        'The current view could not be downloaded',
        async (viewer) => {
          exported = await viewer.exportCurrentImage();
        },
      );
      if (!completed || exported === undefined) return;

      const anchor = element('a');
      anchor.href = exported.dataUrl;
      anchor.download = exported.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    } finally {
      this.#imageButton.disabled = !this.#hasStructure;
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
    const presentation = pageScanPresentation(
      payload.structures.length,
      payload.error,
    );
    this.#pageResults.replaceChildren(this.#pageResultsHeading);
    this.#viewerDetectedItems.replaceChildren();
    this.#pageResultsHeading.textContent = presentation.heading;
    for (const structure of payload.structures) {
      const identifierKey = this.#identifierKey(structure.id);
      const result = button('', { className: 'scan-result' });
      result.setAttribute('aria-label', `Open ${structure.displayId}`);
      if (identifierKey !== undefined) {
        result.dataset.identifierKey = identifierKey;
      }
      result.append(
        element('span', { className: 'result-id', text: structure.displayId }),
        element('span', { className: 'result-arrow', text: '›' }),
      );
      result.addEventListener('click', () => void this.#loadIdentifier(structure.id));
      this.#pageResults.append(result);

      const viewerChip = button(structure.displayId, {
        className: 'viewer-detected-chip',
        title: `Open ${structure.displayId}`,
      });
      viewerChip.setAttribute('aria-label', `Open ${structure.displayId}`);
      if (identifierKey !== undefined) {
        viewerChip.dataset.identifierKey = identifierKey;
      }
      viewerChip.addEventListener('click', () => {
        void this.#loadIdentifier(structure.id);
      });
      this.#viewerDetectedItems.append(viewerChip);
    }
    this.#pageStatus.textContent = presentation.status;
    setHidden(this.#pageHero, presentation.showResults);
    setHidden(this.#pageResults, !presentation.showResults);
    setHidden(this.#viewerDetectedBar, payload.structures.length === 0);
    this.#syncDetectedActiveState();
    this.#setScanBusy(false);
  }

  #identifierKey(input: string): string | undefined {
    const identifier = parseStructureIdentifier(input);
    return identifier === null
      ? undefined
      : `${identifier.type}:${identifier.canonicalValue}`;
  }

  #syncDetectedActiveState(): void {
    for (const container of [this.#pageResults, this.#viewerDetectedItems]) {
      for (const candidate of container.querySelectorAll<HTMLElement>(
        '[data-identifier-key]',
      )) {
        const active =
          candidate.dataset.identifierKey === this.#activeIdentifierKey;
        candidate.classList.toggle('is-current', active);
        if (active) candidate.setAttribute('aria-current', 'true');
        else candidate.removeAttribute('aria-current');
      }
    }
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
