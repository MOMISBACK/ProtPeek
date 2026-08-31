// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import { loadAlphaFoldStructure } from '../../../src/structures/loaders/alphafold';

const origin = 'https://alphafold.ebi.ac.uk';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('AlphaFold loader', () => {
  it('normalizes UniProt input, fetches metadata, and prefers BCIF', async () => {
    const bcifUrl = `${origin}/files/AF-P69905-F1-model_v6.bcif`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            bcifUrl,
            cifUrl: `${origin}/files/AF-P69905-F1-model_v6.cif`,
            entryId: 'AF-P69905-F1',
            uniprotAccession: 'P69905',
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([4, 2]).buffer),
      );
    const controller = new AbortController();

    const result = await loadAlphaFoldStructure(
      ' p69905 ',
      controller.signal,
      fetcher,
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `${origin}/api/prediction/P69905`,
      { credentials: 'omit', signal: controller.signal },
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(bcifUrl);
    expect(result).toMatchObject({
      format: 'mmcif',
      isBinary: true,
      label: 'AF-P69905-F1',
      source: { kind: 'alphafold', id: 'AF-P69905-F1' },
    });
    expect(result.data).toEqual(Uint8Array.from([4, 2]));
  });

  it('extracts UniProt from an AlphaFold ID and selects its exact fragment', async () => {
    const selectedUrl = `${origin}/files/f2.bcif`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          { bcifUrl: `${origin}/files/f1.bcif`, entryId: 'AF-P69905-F1' },
          { bcifUrl: selectedUrl, entryId: 'AF-P69905-F2' },
        ]),
      )
      .mockResolvedValueOnce(new Response(Uint8Array.from([2]).buffer));

    const result = await loadAlphaFoldStructure(
      'af-p69905-f2',
      new AbortController().signal,
      fetcher,
    );

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${origin}/api/prediction/P69905`,
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(selectedUrl);
    expect(result.label).toBe('AF-P69905-F2');
  });

  it('falls back from BCIF to mmCIF download', async () => {
    const cifUrl = `${origin}/files/model.cif`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            bcifUrl: `${origin}/files/model.bcif`,
            cifUrl,
            entryId: 'AF-Q9Y261-F1',
          },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('data_alphafold'));

    const result = await loadAlphaFoldStructure(
      'Q9Y261',
      new AbortController().signal,
      fetcher,
    );

    expect(result).toMatchObject({
      data: 'data_alphafold',
      format: 'mmcif',
      isBinary: false,
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe(cifUrl);
  });

  it('loads mmCIF directly when metadata has no BCIF URL', async () => {
    const cifUrl = `${origin}/files/model.cif`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([{ cifUrl, entryId: 'AF-P69905-F1' }]),
      )
      .mockResolvedValueOnce(new Response('data_cif'));

    const result = await loadAlphaFoldStructure(
      'P69905',
      new AbortController().signal,
      fetcher,
    );

    expect(result.isBinary).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(cifUrl);
  });

  it.each([
    [404, 'not-found'],
    [429, 'network'],
    [503, 'network'],
  ] as const)('maps metadata HTTP %s to %s', async (status, code) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code, name: 'StructureLoadError' });
  });

  it.each([[], {}, null])(
    'reports absent metadata as not-found: %j',
    async (payload) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(payload));

      await expect(
        loadAlphaFoldStructure(
          'P69905',
          new AbortController().signal,
          fetcher,
        ),
      ).rejects.toMatchObject({ code: 'not-found' });
    },
  );

  it('rejects metadata arrays without prediction objects', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(['invalid', null, 42]));

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'invalid-file' });
  });

  it('never downloads an untrusted structure URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse([
        {
          bcifUrl: 'https://alphafold.ebi.ac.uk.evil.test/model.bcif',
          entryId: 'AF-P69905-F1',
        },
      ]),
    );

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'invalid-file' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed BCIF URL and uses a trusted CIF fallback', async () => {
    const cifUrl = `${origin}/files/model.cif`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            bcifUrl: 'not a valid URL',
            cifUrl,
            entryId: 'AF-P69905-F1',
          },
        ]),
      )
      .mockResolvedValueOnce(new Response('fallback'));

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).resolves.toMatchObject({ data: 'fallback', isBinary: false });
  });

  it('maps a metadata transport exception to a network load error', async () => {
    const cause = new TypeError('offline');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(cause);

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ cause, code: 'network' });
  });

  it('maps cancellation during metadata fetch to aborted', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw new Error('request interrupted');
    });

    await expect(
      loadAlphaFoldStructure('P69905', controller.signal, fetcher),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('reports malformed successful JSON metadata as invalid-file', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{broken json'));

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'invalid-file' });
  });

  it('surfaces a missing prediction download as not-found', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            bcifUrl: `${origin}/files/model.bcif`,
            entryId: 'AF-P69905-F1',
          },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      loadAlphaFoldStructure(
        'P69905',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

