// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  fetchFirstAvailable,
  type FetchCandidate,
} from '../../../src/structures/loaders/fetchStructure';

const binaryCandidate: FetchCandidate = {
  format: 'mmcif',
  isBinary: true,
  url: 'https://structures.test/model.bcif',
};

const textCandidate: FetchCandidate = {
  format: 'mmcif',
  isBinary: false,
  url: 'https://structures.test/model.cif',
};

describe('fetchFirstAvailable', () => {
  it('returns binary data from the first successful candidate', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]).buffer),
    );
    const controller = new AbortController();

    const result = await fetchFirstAvailable(
      [binaryCandidate, textCandidate],
      controller.signal,
      fetcher,
    );

    expect(result).toMatchObject({
      format: 'mmcif',
      isBinary: true,
      url: binaryCandidate.url,
    });
    expect(result.data).toEqual(Uint8Array.from([1, 2, 3]));
    expect(result.downloadMs).toBeGreaterThanOrEqual(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(binaryCandidate.url, {
      cache: 'default',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
  });

  it('falls back after an HTTP failure and reads text data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('data_model_test'));

    const result = await fetchFirstAvailable(
      [binaryCandidate, textCandidate],
      new AbortController().signal,
      fetcher,
    );

    expect(result).toMatchObject({
      data: 'data_model_test',
      isBinary: false,
      url: textCandidate.url,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      textCandidate.url,
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('falls back after a transport exception', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response('fallback'));

    await expect(
      fetchFirstAvailable(
        [binaryCandidate, textCandidate],
        new AbortController().signal,
        fetcher,
      ),
    ).resolves.toMatchObject({ data: 'fallback', isBinary: false });
  });

  it('reports not-found when the final service candidate returns 404', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      fetchFirstAvailable(
        [binaryCandidate, textCandidate],
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'not-found', name: 'StructureLoadError' });
  });

  it('does not misreport a final transport failure as an earlier 404', async () => {
    const failure = new TypeError('offline');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(failure);

    await expect(
      fetchFirstAvailable(
        [binaryCandidate, textCandidate],
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({
      cause: failure,
      code: 'network',
      name: 'StructureLoadError',
    });
  });

  it('reports a successful but empty final body as invalid data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(''));

    await expect(
      fetchFirstAvailable(
        [textCandidate],
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({
      code: 'invalid-file',
      name: 'StructureLoadError',
    });
  });

  it('rejects a remotely declared body above the safety limit before reading it', async () => {
    const response = new Response('not read', {
      headers: { 'content-length': String(512 * 1024 * 1024 + 1) },
    });
    const body = vi.spyOn(response, 'arrayBuffer');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      fetchFirstAvailable(
        [binaryCandidate],
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({
      code: 'file-too-large',
      name: 'StructureLoadError',
    });
    expect(body).not.toHaveBeenCalled();
  });

  it('maps cancellation during fetch to an aborted load', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw new Error('transport closed because the signal was aborted');
    });

    await expect(
      fetchFirstAvailable([binaryCandidate], controller.signal, fetcher),
    ).rejects.toMatchObject({ code: 'aborted', name: 'StructureLoadError' });
  });

  it('honors cancellation that occurs while a response body is read', async () => {
    const controller = new AbortController();
    const response = {
      arrayBuffer: async () => {
        controller.abort();
        return Uint8Array.from([1]).buffer;
      },
      ok: true,
      status: 200,
    } as Response;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      fetchFirstAvailable([binaryCandidate], controller.signal, fetcher),
    ).rejects.toMatchObject({ code: 'aborted', name: 'StructureLoadError' });
  });

  it('reports an empty candidate set as a network configuration failure', async () => {
    await expect(
      fetchFirstAvailable(
        [],
        new AbortController().signal,
        vi.fn<typeof fetch>(),
      ),
    ).rejects.toMatchObject({ code: 'network', name: 'StructureLoadError' });
  });
});
