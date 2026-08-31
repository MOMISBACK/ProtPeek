// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  loadRcsbStructure,
  rcsbCandidates,
} from '../../../src/structures/loaders/rcsb';

describe('RCSB loader', () => {
  it.each([
    [
      '8XYZ',
      [
        'https://models.rcsb.org/8xyz.bcif',
        'https://files.rcsb.org/download/8xyz.cif',
      ],
    ],
    [
      'pdb_1000AXYZ',
      [
        'https://models.rcsb.org/pdb_1000axyz.bcif',
        'https://files.rcsb.org/download/pdb_1000axyz.cif',
      ],
    ],
  ])('builds future-proof candidates for %s', (id, expectedUrls) => {
    expect(rcsbCandidates(id).map(({ url }) => url)).toEqual(expectedUrls);
  });

  it('prefers compact BinaryCIF and maps loader metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Uint8Array.from([0x83, 0xa5]).buffer),
    );
    const controller = new AbortController();

    const result = await loadRcsbStructure(
      '8xYz',
      controller.signal,
      fetcher,
    );

    expect(result).toMatchObject({
      format: 'mmcif',
      isBinary: true,
      label: '8XYZ',
      source: { kind: 'pdb', id: '8xYz' },
    });
    expect(result.data).toEqual(Uint8Array.from([0x83, 0xa5]));
    expect(result.downloadMs).toBeGreaterThanOrEqual(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back from unavailable BCIF to canonical mmCIF', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response('data_protpeek'));

    const result = await loadRcsbStructure(
      '8XYZ',
      new AbortController().signal,
      fetcher,
    );

    expect(result).toMatchObject({
      data: 'data_protpeek',
      format: 'mmcif',
      isBinary: false,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://models.rcsb.org/8xyz.bcif',
      'https://files.rcsb.org/download/8xyz.cif',
    ]);
  });

  it('surfaces not-found when neither official endpoint has the entry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      loadRcsbStructure(
        '9ZZZ',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('forwards the same AbortSignal to every fallback request', async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('fallback'));

    await loadRcsbStructure('8XYZ', controller.signal, fetcher);

    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
  });
});

