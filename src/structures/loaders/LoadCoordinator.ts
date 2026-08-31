// SPDX-License-Identifier: MPL-2.0
export class LoadCoordinator {
  #controller: AbortController | undefined;
  #generation = 0;

  async run<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.cancel();
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#controller = controller;

    try {
      const result = await load(controller.signal);
      if (generation !== this.#generation) {
        throw new DOMException('Superseded by another load', 'AbortError');
      }
      return result;
    } finally {
      if (generation === this.#generation) this.#controller = undefined;
    }
  }

  cancel(): void {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = undefined;
  }
}
