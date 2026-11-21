// SPDX-License-Identifier: MPL-2.0
import { AlphaFoldIdentifier, PdbIdentifier, UniProtIdentifier } from '../structures/identifiers';
import type {
  ArticleResult, Organism, ProteinResult, SearchClient, SearchIssue,
  SearchOptions, SearchResponse, SearchSource, StructureResult,
} from './types';

const UNIPROT = 'https://rest.uniprot.org/uniprotkb';
const RCSB_SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query';
const RCSB_DATA = 'https://data.rcsb.org/graphql';
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const ALPHAFOLD = 'https://alphafold.ebi.ac.uk/api/prediction';
const REQUEST_TIMEOUT_MS = 15_000;
const ENTRY_QUERY = `query Entries($ids: [String!]!) {
  entries(entry_ids: $ids) {
    rcsb_id struct { title } exptl { method }
    rcsb_entry_info { resolution_combined }
    rcsb_primary_citation { pdbx_database_id_DOI pdbx_database_id_PubMed }
    polymer_entities {
      rcsb_entity_source_organism { ncbi_scientific_name ncbi_taxonomy_id }
      rcsb_polymer_entity_container_identifiers {
        reference_sequence_identifiers { database_accession database_name }
      }
    }
  }
}`;

type JsonObject = Record<string, unknown>;
type EntryFilter = { accession?: string; doi?: string; pmid?: string };
interface WorkState { response: SearchResponse; attempted: number; succeeded: number }

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject : undefined;
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function at(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) current = object(current)?.[key];
  return current;
}
function quote(value: string): string { return `"${value.replace(/[\\"]/g, '\\$&')}"`; }
function pageSize(options: SearchOptions): number {
  return Math.max(1, Math.min(25, Math.floor(options.limit ?? 12) || 12));
}
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Search was cancelled', 'AbortError');
}
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
function empty(query: string): WorkState {
  return {
    response: { query, proteins: [], articles: [], structures: [], issues: [], hasMore: false, state: 'complete' },
    attempted: 0, succeeded: 0,
  };
}
function issue(state: WorkState, source: SearchSource, message: string, severity: SearchIssue['severity'] = 'error'): void {
  state.response.issues.push({ source, message, severity });
}
function unique<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map(value => [value.id, value])).values()];
}
function finish(state: WorkState): SearchResponse {
  const result = state.response;
  result.proteins = unique(result.proteins);
  result.articles = unique(result.articles);
  result.structures = unique(result.structures).sort((left, right) =>
    Number(left.source === 'alphafold') - Number(right.source === 'alphafold'));
  result.state = result.issues.some(value => value.severity === 'error')
    ? state.succeeded === 0 ? 'unavailable' : 'partial'
    : 'complete';
  return result;
}
function canonicalDoi(value: string): string | undefined {
  let candidate = value.trim().replace(/^doi:\s*/i, '');
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(candidate)) {
    try { candidate = decodeURIComponent(new URL(candidate).pathname.slice(1)); } catch { return undefined; }
  }
  return /^10\.\d{4,9}\/\S+$/i.test(candidate) ? candidate.toLowerCase() : undefined;
}
function pmidFrom(value: string): string | undefined {
  const match = /^(?:PMID\s*:?\s*)?(\d{5,10})$/i.exec(value.trim())
    ?? /^PMID\s*:\s*(\d{1,10})$/i.exec(value.trim())
    ?? /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?(?:[?#].*)?$/i.exec(value.trim());
  return match?.[1];
}
function normalizeQuery(value: string): string {
  const query = value.trim();
  if (!query || query.length > 400) throw new Error('Enter a query between 1 and 400 characters.');
  return query;
}
function organismQuery(organism: string | undefined): string {
  const value = organism?.trim();
  return !value ? '' : /^\d+$/.test(value)
    ? ` AND organism_id:${value}` : ` AND organism_name:${quote(value.slice(0, 160))}`;
}
function proteinFrom(value: unknown): ProteinResult | undefined {
  const entry = object(value);
  const accession = text(entry?.primaryAccession);
  const name = text(at(entry, 'proteinDescription', 'recommendedName', 'fullName', 'value'))
    ?? text(at(list(at(entry, 'proteinDescription', 'submissionNames'))[0], 'fullName', 'value'));
  const organismName = text(at(entry, 'organism', 'scientificName'));
  if (!accession || !UniProtIdentifier.isValid(accession) || !name || !organismName) return undefined;
  const taxonomyId = numeric(at(entry, 'organism', 'taxonId'));
  const gene = text(at(list(entry?.genes)[0], 'geneName', 'value'));
  const length = numeric(at(entry, 'sequence', 'length'));
  return {
    kind: 'protein', id: `uniprot:${accession}`, accession, title: name,
    organism: { name: organismName, ...(taxonomyId === undefined ? {} : { taxonomyId }) },
    reviewed: text(entry?.entryType)?.startsWith('UniProtKB reviewed ') ?? false,
    ...(gene === undefined ? {} : { gene }), ...(length === undefined ? {} : { sequenceLength: length }),
    url: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}`,
  };
}
function articleFrom(value: unknown): ArticleResult | undefined {
  const entry = object(value);
  const title = text(entry?.title);
  const pmid = text(entry?.pmid);
  const doiValue = text(entry?.doi);
  const doi = doiValue ? canonicalDoi(doiValue) : undefined;
  const source = text(entry?.source);
  const recordId = text(entry?.id);
  if (!title || (!doi && !pmid && (!source || !recordId))) return undefined;
  const id = doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : `europepmc:${source}:${recordId}`;
  const year = text(entry?.pubYear), authors = text(entry?.authorString);
  return {
    kind: 'article', id, title,
    ...(doi === undefined ? {} : { doi }), ...(pmid === undefined ? {} : { pmid }),
    ...(year === undefined ? {} : { year }), ...(authors === undefined ? {} : { authors }),
    url: doi ? `https://doi.org/${doi}` : pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      : `https://europepmc.org/article/${encodeURIComponent(source!)}/${encodeURIComponent(recordId!)}`,
  };
}
function sourceOrganisms(entry: JsonObject): Organism[] {
  const seen = new Map<string, Organism>();
  for (const entity of list(entry.polymer_entities)) {
    for (const value of list(at(entity, 'rcsb_entity_source_organism'))) {
      const name = text(at(value, 'ncbi_scientific_name'));
      if (!name) continue;
      const id = numeric(at(value, 'ncbi_taxonomy_id'));
      seen.set(`${id ?? ''}:${name}`, { name, ...(id === undefined ? {} : { taxonomyId: id }) });
    }
  }
  return [...seen.values()];
}
function hasAccession(entry: JsonObject, accession: string): boolean {
  return list(entry.polymer_entities).some(entity =>
    list(at(entity, 'rcsb_polymer_entity_container_identifiers', 'reference_sequence_identifiers'))
      .some(reference => at(reference, 'database_name') === 'UniProt'
        && text(at(reference, 'database_accession'))?.toUpperCase() === accession));
}
function entryMatches(entry: JsonObject, filter: EntryFilter): boolean {
  if (filter.accession && !hasAccession(entry, filter.accession)) return false;
  if (filter.doi) {
    const value = text(at(entry, 'rcsb_primary_citation', 'pdbx_database_id_DOI'));
    if (!value || canonicalDoi(value) !== filter.doi) return false;
  } else if (filter.pmid) {
    const value = at(entry, 'rcsb_primary_citation', 'pdbx_database_id_PubMed');
    if (String(value) !== filter.pmid) return false;
  }
  return true;
}
function pdbFrom(value: unknown, filter: EntryFilter): StructureResult | undefined {
  const entry = object(value), id = text(entry?.rcsb_id);
  const parsed = id ? PdbIdentifier.parse(id) : null;
  if (!entry || !parsed || !entryMatches(entry, filter)) return undefined;
  const methods = list(entry.exptl).map(value => text(at(value, 'method'))).filter((v): v is string => v !== undefined);
  const resolutions = list(at(entry, 'rcsb_entry_info', 'resolution_combined'))
    .map(numeric).filter((v): v is number => v !== undefined && v > 0);
  const resolution = resolutions.length ? Math.min(...resolutions) : undefined;
  return {
    kind: 'structure', id: `pdb:${parsed.canonicalValue}`, identifier: parsed.displayValue,
    title: text(at(entry, 'struct', 'title')) ?? parsed.displayValue, source: 'pdb',
    organisms: sourceOrganisms(entry), url: `https://www.rcsb.org/structure/${parsed.displayValue}`,
    ...(methods.length ? { method: methods.join(', ') } : {}),
    ...(resolution === undefined ? {} : { resolution }),
    ...(filter.accession === undefined ? {} : { proteinAccession: filter.accession }),
  };
}
function terminal(attribute: string, operator: string, value: string | number): JsonObject {
  return { type: 'terminal', service: 'text', parameters: { attribute, operator, value } };
}

/** Public APIs only. There is no proxy, API key, account or query telemetry. */
export function createSearchClient(fetcher: typeof fetch = fetch): SearchClient {
  async function request(url: string, options: SearchOptions, init: RequestInit = {}, notFound = false): Promise<unknown> {
    aborted(options.signal);
    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, { ...init, credentials: 'omit', signal: controller.signal });
      aborted(options.signal);
      if (response.status === 204 || (notFound && response.status === 404)) return null;
      if (!response.ok) throw new Error(response.status === 429
        ? 'Service rate limit reached. Try again later.' : `Service returned HTTP ${response.status}.`);
      const json: unknown = await response.json();
      aborted(options.signal);
      return json;
    } catch (error) {
      aborted(options.signal);
      if (timedOut) throw new Error('Service timed out. Try again later.', { cause: error });
      if (isAbort(error)) throw error;
      throw error instanceof Error ? error : new Error('Service request failed.');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async function attempt(state: WorkState, source: SearchSource, operation: () => Promise<void>): Promise<void> {
    state.attempted++;
    try { await operation(); state.succeeded++; }
    catch (error) {
      if (isAbort(error)) throw error;
      issue(state, source, error instanceof Error ? error.message : 'Service request failed.');
    }
  }

  async function uniprot(query: string, state: WorkState, options: SearchOptions, accession?: string): Promise<void> {
    const fields = 'accession,id,protein_name,gene_names,organism_name,organism_id,reviewed,length';
    const url = accession ? `${UNIPROT}/${encodeURIComponent(accession)}.json`
      : `${UNIPROT}/search?${new URLSearchParams({ query: query + organismQuery(options.organism), format: 'json', fields, size: String(pageSize(options)) })}`;
    const payload = await request(url, options, {}, Boolean(accession));
    if (payload === null) return;
    const records = accession ? [payload] : at(payload, 'results');
    if (!Array.isArray(records)) throw new Error('UniProt returned invalid search data.');
    const results = records.slice(0, pageSize(options)).map(proteinFrom).filter((v): v is ProteinResult => v !== undefined);
    if (records.length && !results.length) throw new Error('UniProt returned no readable protein records.');
    if (accession && results.some(protein => protein.accession !== accession)) {
      throw new Error('UniProt returned a different accession; select its current entry explicitly.');
    }
    state.response.proteins.push(...results);
    if (!accession && records.length >= pageSize(options)) state.response.hasMore = true;
  }

  async function articles(query: string, state: WorkState, options: SearchOptions): Promise<void> {
    const url = `${EUROPE_PMC}?${new URLSearchParams({ query, format: 'json', resultType: 'lite', pageSize: String(pageSize(options)), cursorMark: '*' })}`;
    const payload = await request(url, options);
    const records = at(payload, 'resultList', 'result');
    if (!Array.isArray(records)) throw new Error('Europe PMC returned invalid article data.');
    const results = records.slice(0, pageSize(options)).map(articleFrom).filter((v): v is ArticleResult => v !== undefined);
    if (records.length && !results.length) throw new Error('Europe PMC returned no readable article records.');
    state.response.articles.push(...results);
    const count = numeric(at(payload, 'hitCount'));
    if (count !== undefined && count > records.length) state.response.hasMore = true;
  }

  async function entries(ids: string[], state: WorkState, options: SearchOptions, filter: EntryFilter): Promise<void> {
    const requested = [...new Set(ids.map(id => {
      const parsed = PdbIdentifier.parse(id);
      return parsed?.legacyEquivalent?.displayValue ?? parsed?.displayValue ?? id;
    }))].slice(0, pageSize(options));
    if (!requested.length) return;
    const payload = await request(RCSB_DATA, options, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ENTRY_QUERY, variables: { ids: requested } }),
    });
    const records = at(payload, 'data', 'entries');
    if (!Array.isArray(records)) throw new Error('RCSB returned invalid structure metadata.');
    const requestedIds = new Set(requested.map(id => PdbIdentifier.parse(id)?.identityKey ?? id.toLowerCase()));
    const requestedId = (id: string): boolean => requestedIds.has(PdbIdentifier.parse(id)?.identityKey ?? id.toLowerCase());
    const results = records.map(value => pdbFrom(value, filter))
      .filter((v): v is StructureResult => v !== undefined && requestedId(v.identifier));
    const errors = list(at(payload, 'errors'));
    if (errors.length && !results.length) throw new Error('RCSB structure metadata could not be retrieved.');
    state.response.structures.push(...results);
    if (errors.length) issue(state, 'rcsb', 'Some RCSB structure metadata could not be retrieved.');
    if (records.some(value => value === null)) issue(state, 'rcsb', 'Some requested PDB entries were not available.', 'warning');
    if (records.some(value => { const id = text(at(value, 'rcsb_id')); return id && !requestedId(id); })) {
      issue(state, 'rcsb', 'Unrequested PDB entries were excluded from the metadata response.', 'warning');
    }
    if (Object.keys(filter).length && records.some(value => object(value) && !pdbFrom(value, filter))) {
      issue(state, 'rcsb', 'Some entries were excluded because their exact protein or primary article association could not be confirmed.', 'warning');
    }
  }

  async function pdbSearch(query: JsonObject, state: WorkState, options: SearchOptions, filter: EntryFilter): Promise<void> {
    const payload = await request(RCSB_SEARCH, options, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, return_type: 'entry', request_options: {
        paginate: { start: 0, rows: pageSize(options) }, results_content_type: ['experimental'],
      } }),
    });
    if (payload === null) return;
    const records = at(payload, 'result_set');
    if (!Array.isArray(records)) throw new Error('RCSB returned invalid search results.');
    const ids = records.map(value => text(at(value, 'identifier')))
      .filter((v): v is string => v !== undefined && PdbIdentifier.isValid(v));
    if (records.length && !ids.length) throw new Error('RCSB returned invalid PDB identifiers.');
    const total = numeric(at(payload, 'total_count'));
    if (total !== undefined && total > ids.length) state.response.hasMore = true;
    await entries(ids, state, options, filter);
  }

  async function predictions(accession: string, state: WorkState, options: SearchOptions, requestedId?: string): Promise<void> {
    const payload = await request(`${ALPHAFOLD}/${encodeURIComponent(accession)}`, options, {}, true);
    if (payload === null) return;
    if (!Array.isArray(payload)) throw new Error('AlphaFold DB returned invalid prediction metadata.');
    let count = 0, eligible = 0;
    for (const value of payload) {
      const row = object(value);
      const id = text(row?.entryId) ?? text(row?.modelEntityId);
      const parsed = id ? AlphaFoldIdentifier.parse(id) : null;
      const linkedAccession = text(row?.uniprotAccession)?.toUpperCase();
      // AFDB can return multiple records. Never substitute another accession/fragment.
      if (!row || !parsed || parsed.accession.canonicalValue !== accession || linkedAccession !== accession) continue;
      const url = text(row.cifUrl) ?? text(row.bcifUrl);
      if (!url) continue;
      try { if (new URL(url).origin !== 'https://alphafold.ebi.ac.uk') continue; } catch { continue; }
      eligible++;
      if (requestedId && parsed.canonicalValue !== requestedId) continue;
      const name = text(row.organismScientificName), taxonomyId = numeric(row.taxId);
      state.response.structures.push({
        kind: 'structure', id: `alphafold:${parsed.canonicalValue}`, identifier: parsed.canonicalValue,
        title: text(row.uniprotDescription) ?? parsed.canonicalValue, source: 'alphafold',
        proteinAccession: accession,
        organisms: name ? [{ name, ...(taxonomyId === undefined ? {} : { taxonomyId }) }] : [],
        method: 'AlphaFold prediction', url: `https://alphafold.ebi.ac.uk/entry/${parsed.canonicalValue}`,
      });
      if (++count >= pageSize(options)) { state.response.hasMore ||= payload.length > count; break; }
    }
    if (payload.length && !eligible) throw new Error('AlphaFold DB did not return a model linked to the requested accession.');
  }

  async function proteinStructures(accession: string, state: WorkState, options: SearchOptions): Promise<void> {
    const query = { type: 'group', logical_operator: 'and', nodes: [
      terminal('rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession', 'exact_match', accession),
      terminal('rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name', 'exact_match', 'UniProt'),
    ] };
    await Promise.all([
      attempt(state, 'rcsb', () => pdbSearch(query, state, options, { accession })),
      attempt(state, 'alphafold', () => predictions(accession, state, options)),
    ]);
  }

  async function articleStructures(reference: EntryFilter, state: WorkState, options: SearchOptions): Promise<void> {
    if (reference.doi) {
      await attempt(state, 'rcsb', () => pdbSearch(
        terminal('rcsb_primary_citation.pdbx_database_id_DOI', 'exact_match', reference.doi!),
        state, options, reference));
    } else if (reference.pmid) {
      await attempt(state, 'rcsb', () => pdbSearch(
        terminal('rcsb_pubmed_container_identifiers.pubmed_id', 'equals', Number(reference.pmid)),
        state, options, reference));
    } else issue(state, 'rcsb', 'This article has no DOI or PMID for an exact primary-publication structure lookup.');
  }

  async function structuresForProtein(protein: ProteinResult | string, options: SearchOptions = {}): Promise<SearchResponse> {
    aborted(options.signal);
    const accession = UniProtIdentifier.parse(typeof protein === 'string' ? protein : protein.accession)?.canonicalValue;
    const state = empty(typeof protein === 'string' ? protein : protein.title);
    if (!accession) { issue(state, 'input', 'Enter a valid UniProt accession.'); return finish(state); }
    if (typeof protein !== 'string') state.response.proteins.push(protein);
    else await attempt(state, 'uniprot', () => uniprot('', state, options, accession));
    await proteinStructures(accession, state, options);
    return finish(state);
  }

  async function structuresForArticle(article: ArticleResult, options: SearchOptions = {}): Promise<SearchResponse> {
    aborted(options.signal);
    const state = empty(article.title);
    state.response.articles.push(article);
    const doi = article.doi ? canonicalDoi(article.doi) : undefined;
    const pmid = article.pmid && /^\d+$/.test(article.pmid) ? article.pmid : undefined;
    await articleStructures({ ...(doi ? { doi } : {}), ...(pmid ? { pmid } : {}) }, state, options);
    return finish(state);
  }

  async function search(value: string, options: SearchOptions = {}): Promise<SearchResponse> {
    aborted(options.signal);
    let query: string;
    try { query = normalizeQuery(value); }
    catch (error) { const state = empty(value); issue(state, 'input', error instanceof Error ? error.message : 'Invalid query.'); return finish(state); }
    const identifierText = query.replace(/^(?:PDB|UniProt|AlphaFold)\s*:\s*/i, '');
    const af = AlphaFoldIdentifier.parse(identifierText);
    const pdb = PdbIdentifier.parse(identifierText);
    const accession = UniProtIdentifier.parse(identifierText);
    const doi = canonicalDoi(query), pmid = pmidFrom(query);
    const state = empty(query);
    if (af) {
      await attempt(state, 'alphafold', () => predictions(af.accession.canonicalValue, state, options, af.canonicalValue));
    } else if (pdb && !pmid) {
      await attempt(state, 'rcsb', () => entries([pdb.displayValue], state, options, {}));
    } else if (accession) {
      await attempt(state, 'uniprot', () => uniprot('', state, options, accession.canonicalValue));
      await proteinStructures(accession.canonicalValue, state, options);
    } else if (doi || pmid) {
      const reference = doi ? { doi } : { pmid: pmid! };
      await Promise.all([
        attempt(state, 'europepmc', () => articles(doi ? `DOI:${quote(doi)}` : `EXT_ID:${pmid} AND SRC:MED`, state, options)),
        articleStructures(reference, state, options),
      ]);
    } else {
      const proteinQuery = `(gene_exact:${quote(query)} OR protein_name:${quote(query)})`;
      await Promise.all([
        attempt(state, 'uniprot', () => uniprot(proteinQuery, state, options)),
        attempt(state, 'europepmc', () => articles(`TITLE:${quote(query)}`, state, options)),
      ]);
    }
    return finish(state);
  }

  return { search, structuresForArticle, structuresForProtein };
}

// Resolve fetch lazily so browser/native runtimes and test fetch injection work alike.
export const search: SearchClient['search'] = (query, options) => createSearchClient().search(query, options);
export const structuresForProtein: SearchClient['structuresForProtein'] = (protein, options) =>
  createSearchClient().structuresForProtein(protein, options);
export const structuresForArticle: SearchClient['structuresForArticle'] = (article, options) =>
  createSearchClient().structuresForArticle(article, options);
