// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { createSearchClient } from '../../src/search';
import type { ArticleResult, ProteinResult } from '../../src/search';

const DOI = '10.1016/j.cell.2023.01.013';
const protein = (accession = 'P69905', name = 'Hemoglobin subunit alpha', organism = 'Homo sapiens', taxonId = 9606) => ({
  primaryAccession: accession, entryType: 'UniProtKB reviewed (Swiss-Prot)',
  proteinDescription: { recommendedName: { fullName: { value: name } } },
  genes: [{ geneName: { value: 'HBA1' } }], organism: { scientificName: organism, taxonId }, sequence: { length: 142 },
});
const pdb = (id = '7YWY', accession = 'P69905', doi = DOI, pmid = 36764293) => ({
  rcsb_id: id, struct: { title: 'An experimentally determined structure' },
  exptl: [{ method: 'ELECTRON MICROSCOPY' }], rcsb_entry_info: { resolution_combined: [3.4] },
  rcsb_primary_citation: { pdbx_database_id_DOI: doi, pdbx_database_id_PubMed: pmid },
  polymer_entities: [{
    rcsb_entity_source_organism: [{ ncbi_scientific_name: 'Homo sapiens', ncbi_taxonomy_id: 9606 }],
    rcsb_polymer_entity_container_identifiers: { reference_sequence_identifiers: [
      { database_accession: accession, database_name: 'UniProt' },
    ] },
  }],
});
const prediction = (accession = 'P69905', fragment = 1): Record<string, unknown> => ({
  modelEntityId: `AF-${accession}-F${fragment}`, uniprotAccession: accession,
  uniprotDescription: 'Hemoglobin subunit alpha', organismScientificName: 'Homo sapiens', taxId: 9606,
  // Current metadata supplies the versioned URL; the client must not construct v4/v6 paths.
  cifUrl: `https://alphafold.ebi.ac.uk/files/AF-${accession}-F${fragment}-model_v6.cif`, latestVersion: 6,
});
const article = (doi = DOI, pmid = '36764293', title = 'A molecular device for the redox quality control of GroEL/ES substrates') => ({
  id: pmid, source: 'MED', pmid, doi, title, pubYear: '2023', authorString: 'Dupuy E et al.',
});
const articleResult: ArticleResult = {
  kind: 'article', id: `doi:${DOI}`, title: 'GroEL:CnoX paper', doi: DOI, pmid: '36764293', url: `https://doi.org/${DOI}`,
};
const proteinResult: ProteinResult = {
  kind: 'protein', id: 'uniprot:P69905', accession: 'P69905', title: 'Hemoglobin subunit alpha',
  organism: { name: 'Homo sapiens', taxonomyId: 9606 }, reviewed: true, url: 'https://www.uniprot.org/uniprotkb/P69905',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function requestUrl(input: Parameters<typeof fetch>[0] | undefined): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new Error('Missing fetch URL');
}
function requestBody(init?: RequestInit): string {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
  return init.body;
}
function mockApi(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input, init) => handler(new URL(requestUrl(input)), init));
}
function otherwise(url: URL): Response {
  if (url.hostname === 'rest.uniprot.org') return json({ results: [] });
  if (url.hostname === 'www.ebi.ac.uk') return json({ hitCount: 0, resultList: { result: [] } });
  if (url.hostname === 'search.rcsb.org') return new Response(null, { status: 204 });
  if (url.hostname === 'alphafold.ebi.ac.uk') return json({}, 404);
  throw new Error('Unexpected API: ' + url.href);
}

describe('public search identifiers and scientific associations', () => {
  it('searches a gene with an explicit organism and preserves its species without selecting a homolog', async () => {
    const fetcher = mockApi(url => url.hostname === 'rest.uniprot.org'
      ? json({ results: [protein('P0A6F5', 'Chaperonin GroEL', 'Escherichia coli (strain K12)', 83333)] }) : otherwise(url));
    const result = await createSearchClient(fetcher).search('groEL', { organism: 'Escherichia coli' });
    expect(result.state).toBe('complete');
    expect(result.proteins[0]?.organism).toEqual({ name: 'Escherichia coli (strain K12)', taxonomyId: 83333 });
    expect(result.structures).toEqual([]);
    const url = new URL(requestUrl(fetcher.mock.calls.find(([input]) => requestUrl(input).includes('uniprot'))?.[0]));
    expect(url.searchParams.get('query')).toContain('gene_exact:"groEL"');
    expect(url.searchParams.get('query')).toContain('organism_name:"Escherichia coli"');
    expect(fetcher.mock.calls.some(([input]) => requestUrl(input).includes('rcsb.org'))).toBe(false);
  });

  it('uses the exact taxonomy-ID filter when supplied and bounds the first page', async () => {
    const fetcher = mockApi(otherwise);
    await createSearchClient(fetcher).search('HBA1', { organism: '9606', limit: 999 });
    const url = new URL(requestUrl(fetcher.mock.calls.find(([input]) => requestUrl(input).includes('uniprot'))?.[0]));
    expect(url.searchParams.get('query')).toContain('organism_id:9606');
    expect(url.searchParams.get('size')).toBe('25');
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.credentials).toBe('omit');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('groups experimentally determined PDB structures and verified AFDB predictions separately for an exact accession', async () => {
    const fetcher = mockApi((url, init) => {
      if (url.hostname === 'rest.uniprot.org') return json(protein());
      if (url.hostname === 'search.rcsb.org') {
        const body = JSON.parse(requestBody(init)) as Record<string, unknown>;
        expect(JSON.stringify(body.query)).toContain('database_accession');
        expect(JSON.stringify(body.query)).toContain('P69905');
        expect(JSON.stringify(body.query)).toContain('UniProt');
        expect(body.request_options).toMatchObject({ results_content_type: ['experimental'] });
        return json({ total_count: 1, result_set: [{ identifier: '7YWY' }] });
      }
      if (url.hostname === 'data.rcsb.org') return json({ data: { entries: [pdb()] } });
      if (url.hostname === 'alphafold.ebi.ac.uk') return json([prediction()]);
      return otherwise(url);
    });
    const result = await createSearchClient(fetcher).search('P69905');
    expect(result.state).toBe('complete');
    expect(result.proteins[0]?.accession).toBe('P69905');
    expect(result.structures.map(s => s.source).sort()).toEqual(['alphafold', 'pdb']);
    expect(result.structures.find(s => s.source === 'alphafold')).toMatchObject({
      identifier: 'AF-P69905-F1', proteinAccession: 'P69905', method: 'AlphaFold prediction',
    });
    expect(result.structures.find(s => s.source === 'pdb')).toMatchObject({
      identifier: '7YWY', proteinAccession: 'P69905', method: 'ELECTRON MICROSCOPY', resolution: 3.4,
    });
  });

  it('excludes a structure whose metadata maps only to a different UniProt accession', async () => {
    const fetcher = mockApi(url => {
      if (url.hostname === 'search.rcsb.org') return json({ total_count: 1, result_set: [{ identifier: '7YWY' }] });
      if (url.hostname === 'data.rcsb.org') return json({ data: { entries: [pdb('7YWY', 'P0A6F5')] } });
      return otherwise(url);
    });
    const result = await createSearchClient(fetcher).structuresForProtein(proteinResult);
    expect(result.structures).toEqual([]);
    expect(result.issues.some(i => i.message.includes('exact protein'))).toBe(true);
  });

  it('maps an article DOI only to its exact primary PDB citation, not a secondary citation', async () => {
    const fetcher = mockApi((url, init) => {
      if (url.hostname === 'search.rcsb.org') {
        const body = requestBody(init);
        expect(body).toContain('rcsb_primary_citation.pdbx_database_id_DOI');
        expect(body).toContain(DOI);
        return json({ total_count: 2, result_set: [{ identifier: '7YWY' }, { identifier: '1CRN' }] });
      }
      if (url.hostname === 'data.rcsb.org') return json({ data: { entries: [pdb(), pdb('1CRN', 'P69905', '10.1000/other')] } });
      return otherwise(url);
    });
    const result = await createSearchClient(fetcher).structuresForArticle(articleResult);
    expect(result.structures.map(s => s.identifier)).toEqual(['7YWY']);
    expect(result.articles).toEqual([articleResult]);
  });

  it('uses the searchable PubMed field then verifies the primary citation PMID', async () => {
    const fetcher = mockApi((url, init) => {
      if (url.hostname === 'www.ebi.ac.uk') return json({ hitCount: 1, resultList: { result: [article()] } });
      if (url.hostname === 'search.rcsb.org') {
        const body = JSON.parse(requestBody(init)) as { query: { parameters: unknown } };
        expect(body.query.parameters).toEqual({ attribute: 'rcsb_pubmed_container_identifiers.pubmed_id', operator: 'equals', value: 36764293 });
        return json({ total_count: 2, result_set: [{ identifier: '7YWY' }, { identifier: '1CRN' }] });
      }
      if (url.hostname === 'data.rcsb.org') return json({ data: { entries: [pdb(), pdb('1CRN', 'P69905', DOI, 12345678)] } });
      return otherwise(url);
    });
    const result = await createSearchClient(fetcher).search('PMID:36764293');
    expect(result.structures.map(s => s.identifier)).toEqual(['7YWY']);
    expect(result.articles[0]?.pmid).toBe('36764293');
  });

  it('canonicalizes a DOI URL and keeps ambiguous title candidates instead of selecting the first', async () => {
    const fetcher = mockApi(url => url.hostname === 'www.ebi.ac.uk'
      ? json({ hitCount: 2, resultList: { result: [article(), article('10.1000/second', '12345678', 'Another GroEL study')] } }) : otherwise(url));
    const result = await createSearchClient(fetcher).search('GroEL');
    expect(result.articles).toHaveLength(2);
    expect(result.structures).toEqual([]);
    await createSearchClient(fetcher).search('https://doi.org/10.1016/J.CELL.2023.01.013');
    const urls = fetcher.mock.calls.map(([input]) => new URL(requestUrl(input))).filter(u => u.hostname === 'www.ebi.ac.uk');
    expect(urls.at(-1)?.searchParams.get('query')).toBe(`DOI:"${DOI}"`);
  });

  it('opens a PDB identifier using its metadata without unrelated name or article searches', async () => {
    const fetcher = mockApi(url => {
      expect(url.href).toBe('https://data.rcsb.org/graphql');
      return json({ data: { entries: [pdb('1CRN')] } });
    });
    const result = await createSearchClient(fetcher).search('PDB:1crn');
    expect(result.structures[0]?.identifier).toBe('1CRN');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('recognizes an extended legacy PDB alias without substituting a different entry', async () => {
    const fetcher = mockApi((_url, init) => {
      expect(requestBody(init)).toContain('1CRN');
      return json({ data: { entries: [pdb('1CRN')] } });
    });
    const result = await createSearchClient(fetcher).search('pdb_00001crn');
    expect(result.structures[0]?.identifier).toBe('1CRN');
    expect(result.issues).toEqual([]);
  });

  it('never substitutes another AFDB fragment or another accession', async () => {
    const fetcher = mockApi(() => json([prediction(), prediction('P0A6F5', 2)]));
    const result = await createSearchClient(fetcher).search('AF-P69905-F2');
    expect(result.structures).toEqual([]);
    expect(result.state).toBe('complete');
    const exact = await createSearchClient(mockApi(() => json([prediction('P69905', 2)]))).search('AF-P69905-F2');
    expect(exact.structures[0]?.identifier).toBe('AF-P69905-F2');
  });

  it('rejects malformed AFDB metadata and untrusted structure URLs instead of claiming no prediction exists', async () => {
    for (const payload of [[{ unexpected: 'value' }], [{ ...prediction(), cifUrl: 'https://example.test/model.cif' }]]) {
      const result = await createSearchClient(mockApi(() => json(payload))).search('AF-P69905-F1');
      expect(result.state).toBe('unavailable');
      expect(result.structures).toEqual([]);
      expect(result.issues[0]?.source).toBe('alphafold');
    }
  });

  it('does not substitute an unrequested PDB ID from a mismatched metadata response', async () => {
    const result = await createSearchClient(mockApi(() => json({ data: { entries: [pdb('7YWY')] } }))).search('1CRN');
    expect(result.structures).toEqual([]);
    expect(result.issues[0]?.message).toContain('Unrequested');
  });

  it('handles real empty HTTP204/AFDB404 responses without inventing predictions', async () => {
    const result = await createSearchClient(mockApi(otherwise)).structuresForProtein(proteinResult);
    expect(result.state).toBe('complete');
    expect(result.structures).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});

describe('public search failures, ambiguity and cancellation', () => {
  it('returns unavailable when both search services fail, not a successful no-results response', async () => {
    const result = await createSearchClient(mockApi(() => json({ error: 'down' }, 503))).search('GroEL');
    expect(result.state).toBe('unavailable');
    expect(result.issues.map(i => i.source).sort()).toEqual(['europepmc', 'uniprot']);
    expect(result.issues.every(i => i.message.includes('503'))).toBe(true);
  });

  it('preserves successful article results when UniProt is unavailable', async () => {
    const fetcher = mockApi(url => url.hostname === 'rest.uniprot.org'
      ? json({}, 429) : json({ hitCount: 1, resultList: { result: [article()] } }));
    const result = await createSearchClient(fetcher).search('GroEL');
    expect(result.state).toBe('partial');
    expect(result.articles).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('rate limit');
  });

  it('does not report malformed JSON shapes as a successful empty search', async () => {
    const result = await createSearchClient(mockApi(() => json({ unexpected: [] }))).search('GroEL');
    expect(result.state).toBe('unavailable');
    expect(result.issues).toHaveLength(2);
  });

  it('keeps valid RCSB records while reporting GraphQL partial errors', async () => {
    const result = await createSearchClient(mockApi(() => json({
      data: { entries: [pdb(), null] }, errors: [{ message: 'One entry failed' }],
    }))).search('7YWY');
    expect(result.state).toBe('partial');
    expect(result.structures.map(s => s.identifier)).toEqual(['7YWY']);
    expect(result.issues.some(i => i.source === 'rcsb')).toBe(true);
  });

  it('reports a completely failed GraphQL result as unavailable', async () => {
    const result = await createSearchClient(mockApi(() => json({
      data: { entries: [null] }, errors: [{ message: 'Backend failed' }],
    }))).search('7YWY');
    expect(result.state).toBe('unavailable');
    expect(result.structures).toEqual([]);
  });

  it('de-duplicates records and explicitly marks bounded search pages', async () => {
    const fetcher = mockApi(url => url.hostname === 'rest.uniprot.org'
      ? json({ results: [protein(), protein()] })
      : json({ hitCount: 20, resultList: { result: [article(DOI.toUpperCase()), article()] } }));
    const result = await createSearchClient(fetcher).search('hemoglobin', { limit: 2 });
    expect(result.proteins).toHaveLength(1);
    expect(result.articles).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('returns a clear issue when an article lacks an exact DOI/PMID association', async () => {
    const fetcher = mockApi(otherwise);
    const result = await createSearchClient(fetcher).structuresForArticle({ kind: 'article', id: 'other:1', title: 'Unidentified paper', url: 'https://europepmc.org' });
    expect(result.issues[0]?.message).toContain('no DOI or PMID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not make network calls for empty or overlong queries', async () => {
    const fetcher = mockApi(otherwise), client = createSearchClient(fetcher);
    for (const value of ['', 'x'.repeat(401)]) {
      const result = await client.search(value);
      expect(result.issues[0]?.source).toBe('input');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not start a request after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = mockApi(otherwise);
    await expect(createSearchClient(fetcher).search('GroEL', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('propagates mid-flight cancellation rather than displaying API-unavailable errors', async () => {
    const controller = new AbortController();
    const fetcher = mockApi((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const pending = createSearchClient(fetcher).search('GroEL', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds unavailable-service waits and distinguishes timeouts from caller cancellation', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = mockApi((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      const pending = createSearchClient(fetcher).search('GroEL');
      await vi.advanceTimersByTimeAsync(15_001);
      const result = await pending;
      expect(result.state).toBe('unavailable');
      expect(result.issues.every(value => value.message.includes('timed out'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
