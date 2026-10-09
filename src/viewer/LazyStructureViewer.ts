// SPDX-License-Identifier: MPL-2.0
import type {
  LoadedStructureData,
  ViewerLoadResult,
} from '../structures/types';
import type { StructureViewer, ViewerBackground, ViewerEvents } from './StructureViewer';

export type StructureViewerFactory = (
  container: HTMLElement,
  events: ViewerEvents,
) => Promise<StructureViewer>;

const createMolstarViewer: StructureViewerFactory = async (container, events) => {
  const { MolstarViewer } = await import('./MolstarViewer');
  return MolstarViewer.create(container, events);
};

export class LazyStructureViewer {
  readonly #container: HTMLElement;
  readonly #events: ViewerEvents;
  readonly #createViewer: StructureViewerFactory;
  #background: ViewerBackground = 'white';
  #disposed = false;
  #viewerPromise: Promise<StructureViewer> | undefined;

  constructor(
    container: HTMLElement,
    events: ViewerEvents = {},
    createViewer: StructureViewerFactory = createMolstarViewer,
  ) {
    this.#container = container;
    this.#events = events;
    this.#createViewer = createViewer;
  }

  get initialized(): boolean {
    return this.#viewerPromise !== undefined;
  }

  /**
   * Starts the dynamic Mol* import and viewer creation without loading data.
   * Call this only after an explicit user load request. Concurrent calls share
   * one initialization; a failed attempt is discarded so a later call retries.
   */
  async prepare(): Promise<void> {
    await this.#viewer();
  }

  async load(data: LoadedStructureData): Promise<ViewerLoadResult> {
    return (await this.#viewer()).load(data);
  }

  /** Keeps the preference without importing Mol* until a structure is opened. */
  async setBackground(background: ViewerBackground): Promise<void> {
    this.#background = background;
    await this.withViewer((viewer) => viewer.setBackground(this.#background));
  }

  async withViewer(
    operation: (viewer: StructureViewer) => void | Promise<void>,
  ): Promise<void> {
    if (this.#disposed || this.#viewerPromise === undefined) return;
    await operation(await this.#viewerPromise);
  }

  resize(): void {
    if (this.#disposed || this.#viewerPromise === undefined) return;
    void this.#viewerPromise.then(
      (viewer) => viewer.resize(),
      () => undefined,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#viewerPromise === undefined) return;
    const viewerPromise = this.#viewerPromise;
    this.#viewerPromise = undefined;
    void viewerPromise.then(
      (viewer) => viewer.dispose(),
      () => undefined,
    );
  }

  #viewer(): Promise<StructureViewer> {
    if (this.#disposed) {
      return Promise.reject(new Error('Viewer has been disposed'));
    }
    if (this.#viewerPromise !== undefined) return this.#viewerPromise;

    const viewerPromise = Promise.resolve()
      .then(() => this.#createViewer(this.#container, this.#events))
      .then((viewer) => {
        if (this.#disposed || this.#viewerPromise !== viewerPromise) {
          viewer.dispose();
          throw new Error('Viewer has been disposed');
        }
        viewer.setBackground(this.#background);
        return viewer;
      });
    this.#viewerPromise = viewerPromise;
    void viewerPromise.catch(() => {
      if (this.#viewerPromise === viewerPromise) {
        this.#viewerPromise = undefined;
      }
    });
    return viewerPromise;
  }
}
