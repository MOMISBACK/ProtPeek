// SPDX-License-Identifier: MPL-2.0
import { parseStructureIdentifier } from '../structures/identifiers';
import { loadAlphaFoldStructure } from '../structures/loaders/alphafold';
import { LoadCoordinator } from '../structures/loaders/LoadCoordinator';
import { loadLocalStructure } from '../structures/loaders/local';
import { loadRcsbStructure } from '../structures/loaders/rcsb';
import { StructureLoadError } from '../structures/loaders/errors';
import type { LoadedStructureData } from '../structures/types';
import { LazyStructureViewer } from '../viewer/LazyStructureViewer';
import type { StructureViewer, ViewerBackground } from '../viewer/StructureViewer';
import { button, element, setHidden } from '../ui/components/dom';
import { StructurePanel } from '../ui/components/StructurePanel';
import { ViewerBackgroundPreference } from '../ui/viewerBackgroundPreference';
import {
  search, structuresForProtein, structuresForArticle,
  type SearchResponse, type ProteinResult, type ArticleResult, type StructureResult,
} from '../search';
import { androidFetch, decodeOpenedFile, MAX_ANDROID_FILE_BYTES, nativeHost, sendExport } from './host';
import { recentStructures, rememberStructure } from './recent';

type Loader = (signal: AbortSignal) => Promise<LoadedStructureData>;
type Screen = 'search' | 'structure';
interface ResultContext { kind: 'protein' | 'article'; title: string; }

function icon(label: string, paths: readonly string[], className = ''): HTMLButtonElement {
  const result = button('', { className: `android-icon ${className}`, title: label });
  result.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  result.append(svg);
  return result;
}

function issueMessage(error: unknown): string {
  if (error instanceof StructureLoadError) {
    if (error.code === 'webgl-unavailable') return 'The 3D viewer could not start on this device. WebGL may be unavailable.';
    if (error.code === 'file-too-large') return 'This structure exceeds the 32 MB mobile limit.';
    if (error.code === 'not-found') return 'No structure was found for this identifier.';
    if (error.code === 'unsupported-file') return 'Choose a PDB, CIF, mmCIF, BCIF or GRO file.';
    if (error.code === 'invalid-file') return 'This structure could not be parsed or displayed.';
    if (error.code === 'network') return 'The structure service could not be reached. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'This action could not be completed.';
}

export class AndroidApp {
  readonly #root: HTMLElement;
  readonly #shell = element('main', { className: 'android-app' });
  readonly #header = element('header', { className: 'android-header' });
  readonly #searchView = element('section', { className: 'android-search' });
  readonly #structureView = element('section', { className: 'android-structure' });
  readonly #searchTab = button('Search', { className: 'android-tab' });
  readonly #structureTab = button('Structure', { className: 'android-tab' });
  readonly #query = element('input', { className: 'android-query' });
  readonly #organism = element('input', { className: 'android-organism' });
  readonly #searchButton = button('Search', { className: 'android-primary' });
  readonly #results = element('div', { className: 'android-results' });
  readonly #recent = element('section', { className: 'android-recent' });
  readonly #searchStatus = element('p', { className: 'android-search-status' });
  readonly #resultsBack = button('Back to results', { className: 'android-text' });
  readonly #fileInput = element('input', { className: 'visually-hidden' });
  readonly #frame = element('section', { className: 'viewer-frame android-frame' });
  readonly #host = element('div', { className: 'viewer-host' });
  readonly #modelTitle = element('h1', { className: 'android-model-title' });
  readonly #modelMeta = element('p', { className: 'android-model-meta' });
  readonly #modelNote = element('p', { className: 'android-model-note' });
  readonly #loadStatus = element('p', { className: 'android-load-status' });
  readonly #cancel = button('Cancel', { className: 'android-text' });
  readonly #retry = button('Retry', { className: 'android-text' });
  readonly #hover = element('p', { className: 'hover-label' });
  readonly #rotate = icon('Auto rotate', ['M4 10a8 8 0 1 1 2 8', 'M4 4v6h6']);
  readonly #expand = icon('Expand viewer', ['M8 4H4v4', 'M16 4h4v4', 'M4 16v4h4', 'M20 16v4h-4']);
  readonly #reset = icon('Reset view', ['M3 11a9 9 0 1 1 2.7 7.3', 'M3 5v6h6', 'M9 12h6', 'M12 9v6']);
  readonly #exportButton = icon('Export structure or image', ['M12 3v11', 'M7 10l5 5 5-5', 'M5 18v3h14v-3']);
  readonly #exportMenu = element('div', { className: 'android-export-menu' });
  readonly #toast = element('p', { className: 'android-toast' });
  readonly #viewer: LazyStructureViewer;
  readonly #panel: StructurePanel;
  readonly #coordinator = new LoadCoordinator();
  readonly #resize: ResizeObserver;
  readonly #background: ViewerBackgroundPreference;
  #disposed = false;
  #loaded = false;
  #loading = false;
  #autoRotate = false;
  #expanded = false;
  #screen: Screen = 'search';
  #loadGeneration = 0;
  #actionGeneration = 0;
  #actions: Promise<unknown> = Promise.resolve();
  #lastLoad: (() => Promise<void>) | undefined;
  #searchController: AbortController | undefined;
  #searchGeneration = 0;
  #response: SearchResponse | undefined;
  #context: ResultContext | undefined;
  #previousResponses: Array<{ response: SearchResponse; context: ResultContext | undefined }> = [];
  #toastTimer: number | undefined;

  readonly #fileOpened = (event: Event): void => {
    try { void this.openFile(decodeOpenedFile((event as CustomEvent<unknown>).detail)); }
    catch (error) { this.#notify(issueMessage(error)); }
  };
  readonly #nativeError = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    const message = typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string'
      ? detail.message : 'The Android file operation could not be completed.';
    this.#notify(message);
  };
  readonly #visibility = (): void => { if (document.hidden) this.#stopRotation(); };
  readonly #pause = (): void => this.#stopRotation();
  readonly #backEvent = (event: Event): void => { if (this.handleBack()) event.preventDefault(); };
  readonly #exportComplete = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    const name = typeof detail === 'object' && detail !== null && 'filename' in detail && typeof detail.filename === 'string' ? detail.filename : '';
    this.#notify(name ? `Export prepared: ${name}` : 'Export prepared.');
  };
  readonly #keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.handleBack()) event.preventDefault();
    } else if (event.key === 'Tab' && this.#expanded) {
      const controls = [...this.#frame.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    }
  };

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#background = new ViewerBackgroundPreference({
      get: keys => Promise.resolve(Object.fromEntries(keys.map(key => [key, this.#readPreference(key)]))),
      set: values => { for (const [key, value] of Object.entries(values)) try { localStorage.setItem(key, String(value)); } catch { /* Optional preference. */ } return Promise.resolve(); },
    });
    this.#viewer = new LazyStructureViewer(this.#host, {
      onSelection: residue => this.#panel.highlightResidue(residue),
      onHover: residue => { this.#hover.textContent = residue === null ? '' : `Chain ${residue.chainId} · ${residue.compId} ${residue.number}${residue.insertionCode}`; this.#hover.hidden = residue === null; },
      onContextLost: () => { this.#stopRotation(); this.#notify('The graphics context was lost. Reopen the structure if it does not recover.'); },
      onContextRestored: () => this.#notify('The graphics context was restored.'),
    });
    this.#panel = new StructurePanel({
      onBackground: background => this.#setBackground(background),
      onChainVisible: (id, visible) => this.#action(viewer => viewer.setChainVisible(id, visible)),
      onColorMode: mode => this.#action(viewer => viewer.setColorMode(mode)),
      onColorSelection: color => this.#action(viewer => viewer.colorSelection(color)),
      onFocusSelection: () => { void this.#action(viewer => viewer.focusSelection()); },
      onIsolate: selection => this.#action(viewer => viewer.isolate(selection)),
      onRepresentation: representation => this.#action(viewer => viewer.setRepresentation(representation)),
      onResetView: () => { void this.#action(viewer => viewer.resetCamera()); },
      onSelect: (selection, focus) => { void this.#action(viewer => { viewer.select(selection); if (focus) viewer.focusSelection(); }); },
      onSelectionRepresentation: representation => this.#action(viewer => viewer.setSelectionRepresentation(representation)),
      onShowAll: () => this.#action(async viewer => { await viewer.showAll(); viewer.resetCamera(); }),
    });
    this.#build();
    this.#resize = new ResizeObserver(() => this.#viewer.resize());
    this.#resize.observe(this.#frame);
    window.addEventListener('protpeek:file-opened', this.#fileOpened);
    window.addEventListener('protpeek:error', this.#nativeError);
    window.addEventListener('protpeek:pause', this.#pause);
    window.addEventListener('protpeek:back', this.#backEvent);
    window.addEventListener('protpeek:export-complete', this.#exportComplete);
    document.addEventListener('visibilitychange', this.#visibility);
    document.addEventListener('keydown', this.#keyDown);
  }

  async initialize(): Promise<void> {
    const background = await this.#background.read();
    if (this.#disposed) return;
    this.#applyBackground(background);
    this.#root.dataset.ready = 'true';
    try {
      const theme = nativeHost()?.getTheme?.();
      if (theme === 'light' || theme === 'dark') document.documentElement.dataset.nativeTheme = theme;
      nativeHost()?.ready();
    } catch (error) { this.#notify(issueMessage(error)); }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#searchController?.abort(); this.#coordinator.cancel();
    this.#resize.disconnect(); this.#viewer.dispose(); this.#panel.dispose();
    window.removeEventListener('protpeek:file-opened', this.#fileOpened);
    window.removeEventListener('protpeek:error', this.#nativeError);
    window.removeEventListener('protpeek:pause', this.#pause);
    window.removeEventListener('protpeek:back', this.#backEvent);
    window.removeEventListener('protpeek:export-complete', this.#exportComplete);
    document.removeEventListener('visibilitychange', this.#visibility);
    document.removeEventListener('keydown', this.#keyDown);
    window.clearTimeout(this.#toastTimer);
  }

  handleBack(): boolean {
    if (!this.#exportMenu.hidden) { this.#exportMenu.hidden = true; this.#exportButton.setAttribute('aria-expanded', 'false'); return true; }
    if (this.#expanded) { this.#setExpanded(false); this.#expand.focus(); return true; }
    if (this.#screen === 'structure') { this.#show('search'); return true; }
    const previous = this.#previousResponses.pop();
    if (previous) { this.#searchController?.abort(); this.#searchGeneration++; this.#searchButton.disabled = false; this.#results.inert = false; this.#context = previous.context; this.#renderResponse(previous.response); return true; }
    return false;
  }

  #build(): void {
    this.#root.dataset.ready = 'false';
    this.#shell.dataset.loading = 'false'; this.#shell.dataset.searchState = 'idle'; this.#frame.dataset.viewerState = 'idle';
    this.#searchTab.id = 'android-search-tab'; this.#structureTab.id = 'android-structure-tab';
    const logo = element('img', { className: 'android-logo' });
    logo.src = new URL('../../public/icon-48.png', import.meta.url).href; logo.alt = 'ProtPeek';
    const brand = element('div', { className: 'android-brand' }, [logo, element('strong', { text: 'ProtPeek' })]);
    const nav = element('nav', { className: 'android-nav' }, [this.#searchTab, this.#structureTab]);
    nav.setAttribute('aria-label', 'ProtPeek views');
    this.#header.append(brand, nav);
    this.#searchTab.onclick = () => this.#show('search');
    this.#structureTab.onclick = () => this.#show('structure');
    this.#query.type = 'search'; this.#query.placeholder = 'Protein, gene, ID, DOI or article title';
    this.#query.id = 'android-query'; this.#organism.id = 'android-organism';
    this.#query.maxLength = 400; this.#query.autocomplete = 'off'; this.#query.spellcheck = false;
    this.#query.setAttribute('aria-label', 'Protein, gene, structure identifier or article');
    this.#organism.type = 'search'; this.#organism.placeholder = 'Organism for proteins, optional'; this.#organism.maxLength = 100;
    this.#organism.setAttribute('aria-label', 'Organism filter for protein results');
    const queryRow = element('div', { className: 'android-query-row' }, [this.#query, this.#searchButton]);
    const form = element('form', { className: 'android-search-form' }, [queryRow, this.#organism]);
    this.#searchButton.type = 'submit';
    form.onsubmit = event => { event.preventDefault(); this.#previousResponses = []; void this.#find(); this.#query.blur(); this.#organism.blur(); };
    const open = button('Open a local file', { className: 'android-secondary' });
    open.onclick = () => {
      try { const host = nativeHost(); if (host) host.openFile(); else this.#fileInput.click(); }
      catch (error) { this.#notify(issueMessage(error)); }
    };
    this.#fileInput.type = 'file'; this.#fileInput.id = 'android-file-input'; this.#fileInput.accept = '.pdb,.cif,.mmcif,.bcif,.gro';
    this.#fileInput.onchange = () => { const file = this.#fileInput.files?.[0]; this.#fileInput.value = ''; if (file) void this.openFile(file); };
    const examples = element('div', { className: 'android-examples' });
    for (const text of ['groEL', '1AON', 'P0A6F5']) {
      const example = button(text, { className: 'android-example' });
      example.onclick = () => { this.#query.value = text; this.#previousResponses = []; void this.#find(); };
      examples.append(example);
    }
    this.#searchStatus.setAttribute('role', 'status'); this.#searchStatus.setAttribute('aria-live', 'polite');
    this.#resultsBack.onclick = () => this.handleBack();
    this.#searchView.append(
      element('div', { className: 'android-intro' }, [element('h1', { text: 'Find a protein. See its structure.' }), element('p', { text: 'Search proteins, genes and structures, or find structures associated with a publication.' })]),
      form, examples, element('div', { className: 'android-file-row' }, [open, element('span', { text: 'PDB · CIF · BCIF · GRO' })]), this.#fileInput,
      this.#searchStatus, this.#resultsBack, this.#results, this.#recent,
    );
    const modelHeader = element('div', { className: 'android-model-header' }, [this.#modelTitle, this.#modelMeta, this.#modelNote]);
    this.#cancel.onclick = () => this.#cancelLoad();
    this.#retry.onclick = () => { void this.#lastLoad?.(); };
    this.#loadStatus.setAttribute('role', 'status'); this.#loadStatus.setAttribute('aria-live', 'polite');
    const loading = element('div', { className: 'android-loading' }, [this.#loadStatus, this.#cancel, this.#retry]);
    this.#reset.onclick = () => { this.#panel.resetViewState(); void this.#action(viewer => viewer.resetCamera()); };
    this.#rotate.setAttribute('aria-pressed', 'false');
    this.#rotate.onclick = () => { const enabled = !this.#autoRotate; this.#autoRotate = enabled; this.#rotate.setAttribute('aria-pressed', String(enabled)); void this.#action(viewer => viewer.setAutoRotate(enabled)).then(ok => { if (!ok) this.#stopRotation(); }); };
    this.#expand.setAttribute('aria-pressed', 'false'); this.#expand.onclick = () => this.#setExpanded(!this.#expanded);
    this.#exportButton.onclick = () => { this.#exportMenu.hidden = !this.#exportMenu.hidden; this.#exportButton.setAttribute('aria-expanded', String(!this.#exportMenu.hidden)); };
    this.#exportButton.setAttribute('aria-expanded', 'false');
    for (const [label, format, share] of [
      ['Save CIF', 'cif', false], ['Share CIF', 'cif', true], ['Save PNG', 'png', false], ['Share PNG', 'png', true],
    ] as const) {
      const action = button(label, { className: 'android-export-action' }); action.dataset.exportFormat = format; action.dataset.exportAction = share ? 'share' : 'save'; action.onclick = () => { void this.#export(format, share); }; this.#exportMenu.append(action);
    }
    this.#exportMenu.setAttribute('aria-label', 'Export visible structure or image');
    const tools = element('div', { className: 'android-tools' }, [this.#reset, this.#rotate, this.#expand, this.#exportButton]);
    this.#hover.hidden = true; this.#exportMenu.hidden = true;
    this.#frame.append(this.#host, loading, this.#hover, tools, this.#exportMenu);
    this.#structureView.append(modelHeader, this.#frame, this.#panel.inspector);
    this.#toast.setAttribute('role', 'status'); this.#toast.hidden = true;
    this.#shell.append(this.#header, this.#searchView, this.#structureView, this.#toast);
    this.#root.replaceChildren(this.#shell);
    this.#renderRecent(); this.#show('search'); this.#updateActions();
    setHidden(this.#cancel, true); setHidden(this.#retry, true); setHidden(this.#resultsBack, true);
  }

  #readPreference(key: string): string | undefined { try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; } }
  #applyBackground(background: ViewerBackground): void { this.#panel.setBackground(background); void this.#viewer.setBackground(background).catch(error => this.#notify(issueMessage(error))); }
  #setBackground(background: ViewerBackground): void { this.#applyBackground(background); void this.#background.set(background).catch(() => undefined); }
  #notify(message: string): void { this.#toast.textContent = message; this.#toast.hidden = false; window.clearTimeout(this.#toastTimer); this.#toastTimer = window.setTimeout(() => { this.#toast.hidden = true; }, 6_000); }
  #show(screen: Screen): void {
    if (screen === 'structure' && !this.#loaded && !this.#loading) return;
    if (screen === 'search') { this.#stopRotation(); this.#setExpanded(false); if (this.#loading) this.#cancelLoad(); }
    this.#screen = screen; this.#shell.dataset.screen = screen; this.#searchView.hidden = screen !== 'search'; this.#structureView.hidden = screen !== 'structure';
    this.#searchTab.setAttribute('aria-current', screen === 'search' ? 'page' : 'false');
    this.#structureTab.setAttribute('aria-current', screen === 'structure' ? 'page' : 'false');
    if (screen === 'structure') requestAnimationFrame(() => this.#viewer.resize());
  }
  #updateActions(): void { this.#shell.dataset.loading = String(this.#loading); this.#structureTab.disabled = !this.#loaded && !this.#loading; for (const action of [this.#reset, this.#rotate, this.#expand, this.#exportButton]) action.disabled = !this.#loaded || this.#loading; }
  #stopRotation(): void {
    this.#autoRotate = false; this.#rotate.setAttribute('aria-pressed', 'false');
    this.#actions = this.#actions.catch(() => undefined).then(() => this.#viewer.withViewer(viewer => viewer.setAutoRotate(false))).catch(() => undefined);
  }
  #setExpanded(expanded: boolean): void {
    this.#expanded = expanded; this.#frame.classList.toggle('is-expanded', expanded);
    this.#expand.setAttribute('aria-pressed', String(expanded)); this.#expand.setAttribute('aria-label', expanded ? 'Collapse viewer' : 'Expand viewer');
    this.#header.inert = expanded; this.#panel.inspector.inert = expanded;
    requestAnimationFrame(() => this.#viewer.resize());
  }

  async #find(): Promise<void> {
    const query = this.#query.value.trim();
    if (query.length < 2) { this.#searchStatus.textContent = 'Enter a protein, gene, identifier or article.'; return; }
    await this.#runSearch(query, signal => search(query, { signal, organism: this.#organism.value.trim(), limit: 16 }));
  }
  async #runSearch(label: string, request: (signal: AbortSignal) => Promise<SearchResponse>, context?: ResultContext): Promise<void> {
    this.#searchController?.abort(); const controller = new AbortController(); this.#searchController = controller;
    this.#context = context;
    const generation = ++this.#searchGeneration;
    this.#shell.dataset.searchState = 'loading';
    this.#searchStatus.textContent = `Searching ${label}…`; this.#searchButton.disabled = true; this.#results.inert = true;
    try {
      const response = await request(controller.signal);
      if (generation !== this.#searchGeneration || this.#disposed) return;
      this.#renderResponse(response);
    } catch (error) {
      if (!controller.signal.aborted && !this.#disposed) { this.#searchStatus.textContent = `Search could not be completed. ${issueMessage(error)}`; this.#shell.dataset.searchState = 'unavailable'; }
    } finally {
      if (generation === this.#searchGeneration) { this.#searchButton.disabled = false; this.#results.inert = false; }
    }
  }
  #renderResponse(response: SearchResponse): void {
    this.#shell.dataset.searchState = response.state;
    this.#response = response; this.#results.replaceChildren();
    this.#resultsBack.hidden = this.#previousResponses.length === 0;
    const count = this.#context ? response.structures.length : response.proteins.length + response.structures.length + response.articles.length;
    const empty = this.#context?.kind === 'article' ? 'No structures with this article as their primary publication were found.' : this.#context?.kind === 'protein' ? 'No structures could be confirmed for this exact protein accession.' : 'No matching results were found.';
    this.#searchStatus.textContent = response.state === 'unavailable' ? 'Search services are currently unavailable.' : count === 0 && response.state === 'partial' ? 'No results could be confirmed. Some sources could not be reached.' : count === 0 ? empty : `${count} ${this.#context ? 'structures' : 'results'}`;
    if (this.#context) this.#results.append(element('h2', { className: 'android-context-title', text: this.#context.title }));
    for (const issue of response.issues) this.#results.append(element('p', { className: 'android-search-issue', text: `${issue.source}: ${issue.message}` }));
    this.#appendGroup('Proteins', response.proteins, item => this.#proteinCard(item));
    this.#appendGroup('Structures', response.structures, item => this.#structureCard(item));
    this.#appendGroup('Publications', response.articles, item => this.#articleCard(item));
    if (response.hasMore) this.#results.append(element('p', { className: 'android-results-note', text: 'Refine your search or organism to narrow these results.' }));
  }
  #appendGroup<T>(title: string, items: readonly T[], make: (item: T) => HTMLElement): void {
    if (!items.length) return;
    const section = element('section', { className: 'android-result-group' }, [element('h2', { text: title })]);
    for (const item of items) section.append(make(item)); this.#results.append(section);
  }
  #card(title: string, description: string, tag: string): HTMLElement {
    return element('article', { className: 'android-result' }, [element('div', { className: 'android-result-top' }, [element('span', { className: 'android-result-tag', text: tag })]), element('h3', { text: title }), element('p', { text: description })]);
  }
  #proteinCard(item: ProteinResult): HTMLElement {
    const card = this.#card(item.title, `${item.organism.name} · ${item.accession}${item.gene ? ` · ${item.gene}` : ''}`, item.reviewed ? 'Reviewed · UniProt' : 'UniProt');
    card.dataset.kind = 'protein'; card.dataset.id = item.accession;
    const action = button('Find structures', { className: 'android-result-action' });
    action.onclick = () => { if (this.#response) this.#previousResponses.push({ response: this.#response, context: this.#context }); void this.#runSearch(item.title, signal => structuresForProtein(item, { signal, limit: 20 }), { kind: 'protein', title: `${item.title} · ${item.accession}` }); };
    if (this.#context?.kind !== 'protein') card.append(action); return card;
  }
  #structureCard(item: StructureResult): HTMLElement {
    const facts = [item.identifier, item.proteinAccession, ...new Set(item.organisms.map(organism => organism.name)), item.method, item.resolution ? `${item.resolution} Å` : undefined].filter(Boolean).join(' · ');
    const card = this.#card(item.title, facts, item.source === 'alphafold' ? 'Prediction · AlphaFold' : 'Experimental · PDB');
    card.dataset.kind = 'structure'; card.dataset.id = item.identifier; card.dataset.source = item.source;
    const action = button('Open structure', { className: 'android-result-action' }); action.onclick = () => { void this.openIdentifier(item.identifier); }; card.append(action); return card;
  }
  #articleCard(item: ArticleResult): HTMLElement {
    const card = this.#card(item.title, [item.year, item.doi ? `DOI ${item.doi}` : item.pmid ? `PMID ${item.pmid}` : undefined].filter(Boolean).join(' · '), 'Publication');
    card.dataset.kind = 'article'; card.dataset.id = item.id;
    const action = button('Find associated structures', { className: 'android-result-action' });
    action.onclick = () => { if (this.#response) this.#previousResponses.push({ response: this.#response, context: this.#context }); void this.#runSearch(item.title, signal => structuresForArticle(item, { signal, limit: 20 }), { kind: 'article', title: item.title }); };
    if (this.#context?.kind !== 'article') card.append(action); return card;
  }
  #renderRecent(): void {
    this.#recent.replaceChildren(); const values = recentStructures();
    if (!values.length) return;
    this.#recent.append(element('h2', { text: 'Recent identifiers' }), element('p', { className: 'android-recent-note', text: 'An internet connection is needed to reopen these structures.' }));
    for (const item of values) { const action = button(item.identifier, { className: 'android-recent-entry', title: item.label }); action.onclick = () => { void this.openIdentifier(item.identifier); }; this.#recent.append(action); }
  }

  async openIdentifier(input: string): Promise<void> {
    const identifier = parseStructureIdentifier(input);
    if (!identifier) { this.#notify('Enter a valid PDB, UniProt or AlphaFold identifier.'); return; }
    const loader: Loader = identifier.type === 'pdb'
      ? signal => loadRcsbStructure(identifier.canonicalValue, signal, androidFetch)
      : signal => loadAlphaFoldStructure(identifier.canonicalValue, signal, androidFetch);
    await this.#load(identifier.displayValue, loader, identifier.displayValue);
  }
  async openFile(file: File): Promise<void> {
    if (file.size > MAX_ANDROID_FILE_BYTES) { this.#notify('Choose a structure smaller than 32 MB.'); return; }
    await this.#load(file.name, signal => loadLocalStructure(file, signal));
  }
  async #load(label: string, loader: Loader, remoteIdentifier?: string): Promise<void> {
    const generation = ++this.#loadGeneration; this.#actionGeneration++;
    this.#stopRotation(); this.#setExpanded(false); this.#loading = true;
    this.#lastLoad = () => this.#load(label, loader, remoteIdentifier);
    this.#frame.dataset.viewerState = 'loading'; this.#loadStatus.dataset.error = 'false';
    this.#loadStatus.textContent = `Opening ${label}…`; this.#cancel.hidden = false; this.#retry.hidden = true;
    this.#panel.setBusy(true); this.#updateActions(); this.#show('structure');
    void this.#viewer.withViewer(viewer => viewer.cancelCurrentTask()).catch(() => undefined);
    try {
      const result = await this.#coordinator.run(async signal => {
        const [data] = await Promise.all([loader(signal), this.#viewer.prepare()]);
        const bytes = typeof data.data === 'string' ? new Blob([data.data]).size : data.data.byteLength;
        if (bytes > MAX_ANDROID_FILE_BYTES) throw new StructureLoadError('file-too-large', 'Choose a structure smaller than 32 MB.');
        await this.#actions.catch(() => undefined);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        this.#loaded = false; this.#panel.clear();
        const result = await this.#viewer.load(data);
        return { ...result, data };
      });
      if (generation !== this.#loadGeneration || this.#disposed) return;
      this.#loaded = true; this.#panel.setMetadata(result.metadata);
      this.#frame.dataset.viewerState = 'ready'; this.#structureView.dataset.identifier = label;
      this.#modelTitle.textContent = label;
      this.#modelMeta.textContent = `${result.metadata.atomCount.toLocaleString()} atoms · ${result.metadata.chains.length} chains · ${result.metadata.source.kind === 'alphafold' ? 'AlphaFold prediction' : result.metadata.source.kind === 'pdb' ? 'PDB structure' : 'Local file'}`;
      this.#modelNote.textContent = result.metadata.source.kind === 'alphafold' ? 'Predicted model. Confidence is not experimental validation.' : result.data.format === 'gro' ? 'GRO: first frame only; chains and bonds are inferred.' : '';
      this.#loadStatus.textContent = ''; this.#lastLoad = undefined;
      if (remoteIdentifier) { rememberStructure(remoteIdentifier, label); this.#renderRecent(); }
    } catch (error) {
      if (generation === this.#loadGeneration && !(error instanceof StructureLoadError && error.code === 'aborted') && !(error instanceof DOMException && error.name === 'AbortError')) {
        this.#loadStatus.textContent = issueMessage(error); this.#retry.hidden = false;
        this.#loadStatus.dataset.error = 'true'; this.#frame.dataset.viewerState = 'error';
      }
    } finally {
      if (generation === this.#loadGeneration) { this.#loading = false; this.#cancel.hidden = true; this.#panel.setBusy(false); this.#updateActions(); }
    }
  }
  #cancelLoad(): void {
    this.#loadGeneration++; this.#actionGeneration++; this.#coordinator.cancel(); this.#loading = false;
    this.#lastLoad = undefined;
    void this.#viewer.withViewer(viewer => viewer.cancelCurrentTask()).catch(() => undefined);
    this.#cancel.hidden = true; this.#retry.hidden = true; this.#loadStatus.textContent = '';
    this.#frame.dataset.viewerState = this.#loaded ? 'ready' : 'idle'; this.#loadStatus.dataset.error = 'false';
    this.#panel.setBusy(false); this.#updateActions();
    if (!this.#loaded && this.#screen === 'structure') this.#show('search');
  }
  async #action(operation: (viewer: StructureViewer) => void | Promise<void>): Promise<boolean> {
    if (!this.#loaded || this.#loading || this.#disposed) return false;
    const generation = this.#actionGeneration;
    const task = this.#actions.then(async () => {
      if (generation !== this.#actionGeneration || this.#disposed) throw new StructureLoadError('aborted', 'Action cancelled');
      await this.#viewer.withViewer(operation);
    });
    this.#actions = task.catch(() => undefined);
    try { await task; return true; }
    catch (error) { if (!(error instanceof StructureLoadError && error.code === 'aborted')) this.#notify(issueMessage(error)); return false; }
  }
  async #export(format: 'png' | 'cif', share: boolean): Promise<void> {
    this.#exportMenu.hidden = true; this.#exportButton.setAttribute('aria-expanded', 'false');
    this.#stopRotation();
    await this.#action(async viewer => {
      if (format === 'cif') {
        const file = viewer.exportCurrentStructure();
        if (new Blob([file.text]).size > MAX_ANDROID_FILE_BYTES) throw new Error('This export exceeds the 32 MB mobile limit.');
        sendExport({ filename: file.filename, mimeType: file.mimeType, text: file.text }, share);
      } else {
        const file = await viewer.exportCurrentImage();
        const base64 = file.dataUrl.split(',')[1];
        if (!base64) throw new Error('This image could not be exported.');
        if (base64.length > Math.ceil(MAX_ANDROID_FILE_BYTES / 3) * 4) throw new Error('This export exceeds the 32 MB mobile limit.');
        sendExport({ filename: file.filename, mimeType: file.mimeType, base64 }, share);
      }
    });
  }
}
