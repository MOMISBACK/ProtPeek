// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import { LoadCoordinator } from '../../../src/structures/loaders/LoadCoordinator';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] = () => undefined;
  let reject: Deferred<T>['reject'] = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('LoadCoordinator', () => {
  it('passes a live signal through and returns generic loader results', async () => {
    const coordinator = new LoadCoordinator();
    let receivedSignal: AbortSignal | undefined;

    const result = await coordinator.run(async (signal) => {
      receivedSignal = signal;
      return { id: 42 };
    });

    expect(result).toEqual({ id: 42 });
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('aborts the previous signal when a newer request starts', async () => {
    const coordinator = new LoadCoordinator();
    const first = deferred<string>();
    let firstSignal: AbortSignal | undefined;
    const firstRun = coordinator.run((signal) => {
      firstSignal = signal;
      return first.promise;
    });
    const staleResult = expect(firstRun).rejects.toMatchObject({
      name: 'AbortError',
    });

    const secondRun = coordinator.run(async () => 'newest');

    expect(firstSignal?.aborted).toBe(true);
    await expect(secondRun).resolves.toBe('newest');
    first.resolve('stale');
    await staleResult;
  });

  it('lets a signal-aware superseded loader reject immediately', async () => {
    const coordinator = new LoadCoordinator();
    const firstRun = coordinator.run(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Superseded', 'AbortError')),
            { once: true },
          );
        }),
    );
    const staleResult = expect(firstRun).rejects.toMatchObject({
      name: 'AbortError',
    });

    await expect(coordinator.run(async () => 'latest')).resolves.toBe('latest');
    await staleResult;
  });

  it('does not let stale cleanup detach the active controller', async () => {
    const coordinator = new LoadCoordinator();
    const stale = deferred<string>();
    const active = deferred<string>();
    let activeSignal: AbortSignal | undefined;
    const staleRun = coordinator.run(() => stale.promise);
    const staleResult = expect(staleRun).rejects.toMatchObject({
      name: 'AbortError',
    });
    const activeRun = coordinator.run((signal) => {
      activeSignal = signal;
      return active.promise;
    });
    const activeResult = expect(activeRun).rejects.toMatchObject({
      name: 'AbortError',
    });

    stale.resolve('obsolete');
    await staleResult;
    coordinator.cancel();
    expect(activeSignal?.aborted).toBe(true);
    active.resolve('too late');
    await activeResult;
  });

  it('cancel aborts the current request and suppresses a late result', async () => {
    const coordinator = new LoadCoordinator();
    const pending = deferred<number>();
    let signal: AbortSignal | undefined;
    const run = coordinator.run((loadSignal) => {
      signal = loadSignal;
      return pending.promise;
    });
    const result = expect(run).rejects.toMatchObject({ name: 'AbortError' });

    coordinator.cancel();
    expect(signal?.aborted).toBe(true);
    pending.resolve(1);
    await result;
  });

  it('does not abort the signal of an already completed request', async () => {
    const coordinator = new LoadCoordinator();
    let completedSignal: AbortSignal | undefined;

    await coordinator.run(async (signal) => {
      completedSignal = signal;
      return 'done';
    });
    coordinator.cancel();
    coordinator.cancel();

    expect(completedSignal?.aborted).toBe(false);
  });

  it('cleans up after loader failure and remains reusable', async () => {
    const coordinator = new LoadCoordinator();
    const failure = new Error('parse failed');
    const failedLoader = vi.fn(async () => {
      throw failure;
    });

    await expect(coordinator.run(failedLoader)).rejects.toBe(failure);
    await expect(coordinator.run(async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  });
});

