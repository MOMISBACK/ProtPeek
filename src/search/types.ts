// SPDX-License-Identifier: MPL-2.0
export interface Organism {
  name: string;
  taxonomyId?: number;
}

export interface ProteinResult {
  kind: 'protein';
  id: string;
  accession: string;
  title: string;
  gene?: string;
  organism: Organism;
  reviewed: boolean;
  sequenceLength?: number;
  url: string;
}

export interface ArticleResult {
  kind: 'article';
  id: string;
  title: string;
  doi?: string;
  pmid?: string;
  year?: string;
  authors?: string;
  url: string;
}

export interface StructureResult {
  kind: 'structure';
  id: string;
  /** An identifier accepted by the existing structure loaders. */
  identifier: string;
  title: string;
  source: 'pdb' | 'alphafold';
  organisms: Organism[];
  method?: string;
  resolution?: number;
  proteinAccession?: string;
  url: string;
}

export type SearchSource = 'uniprot' | 'rcsb' | 'alphafold' | 'europepmc' | 'input';

export interface SearchIssue {
  source: SearchSource;
  message: string;
  severity: 'error' | 'warning';
}

export interface SearchResponse {
  query: string;
  proteins: ProteinResult[];
  articles: ArticleResult[];
  structures: StructureResult[];
  issues: SearchIssue[];
  /** Only a bounded first page is retrieved. Refine the query when true. */
  hasMore: boolean;
  state: 'complete' | 'partial' | 'unavailable';
}

export interface SearchOptions {
  signal?: AbortSignal;
  /** UniProt scientific/common organism name, or an exact NCBI taxonomy ID. */
  organism?: string;
  /** Per-source first-page size; bounded to 1–25. */
  limit?: number;
}

export interface SearchClient {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  structuresForProtein(protein: ProteinResult | string, options?: SearchOptions): Promise<SearchResponse>;
  structuresForArticle(article: ArticleResult, options?: SearchOptions): Promise<SearchResponse>;
}
