# Public search APIs

`createSearchClient(fetcher)` is injectable for tests. The exported `search`,
`structuresForProtein` and `structuresForArticle` use the runtime's native
`fetch`. Requests omit credentials, accept cancellation, time out after 15 s,
and retrieve a single bounded page (default 12; maximum 25 records per source).
`hasMore` means the user should refine the query; results are never presented as
an exhaustive database export.

- **UniProt:** `https://rest.uniprot.org/uniprotkb/search` and exact-accession
  entry JSON. Gene/protein names return explicit candidates with their original
  organism and NCBI taxonomy ID. There is no default human organism and no
  automatic selection of a homolog. The optional organism filter uses
  `organism_id` for a numeric taxonomy ID or `organism_name` for a name.
- **RCSB Search:** `https://search.rcsb.org/rcsbsearch/v2/query` with
  `results_content_type: ["experimental"]`. Protein lookup requires exact
  UniProt accession + database name. Article lookup uses exact
  `rcsb_primary_citation.pdbx_database_id_DOI`, or the searchable numeric field
  `rcsb_pubmed_container_identifiers.pubmed_id`. HTTP 204 is a real empty result.
- **RCSB GraphQL:** `https://data.rcsb.org/graphql` retrieves a bounded batch of
  entry metadata, primary citation and polymer-entity source organisms and
  UniProt references. Exact protein/primary-publication associations are checked
  again after search, including the primary PMID. GraphQL errors remain visible.
- **Europe PMC:** `https://www.ebi.ac.uk/europepmc/webservices/rest/search` uses
  DOI, `EXT_ID:<PMID> AND SRC:MED`, or title queries. Title candidates are not
  automatically treated as the same article. Structure associations are primary
  publications, not arbitrary articles mentioning or reusing a structure.
- **AlphaFold DB:** `https://alphafold.ebi.ac.uk/api/prediction/<accession>`.
  Metadata is validated against the exact accession and requested fragment,
  accepts `entryId` or `modelEntityId`, and requires a trusted current download
  URL. No model is invented on 404 and no version number is hardcoded. Models
  are explicitly distinguished from experimental PDB entries.

API failures populate `issues` and set `state` to `partial` or `unavailable`;
they are never silently converted to successful empty results. Aborts reject
with `AbortError`.

Official references, checked against live endpoints on 2026-11-21:

- https://www.uniprot.org/help/api_queries
- https://search.rcsb.org/#search-api
- https://data.rcsb.org/
- https://europepmc.org/RestfulWebService
- https://alphafold.ebi.ac.uk/api-docs
