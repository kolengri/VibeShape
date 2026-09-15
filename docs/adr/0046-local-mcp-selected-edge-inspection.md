# ADR-0046: Local MCP Selected-edge Inspection and Authoring

- Status: Accepted
- Date: 2026-09-07
- Related: [ADR-0040](0040-selected-edge-treatments.md), [ADR-0041](0041-revision-bound-model-measurements.md), [ADR-0045](0045-local-mcp-variables-and-chamfer.md)

## Decision

Add the named `model_edges` tool and extend existing Fillet/Chamfer create/update tools with optional
`edges`. The local adapter now exposes twenty-six tools. This extends the existing document core
query registry, domain topology contracts, application evidence projection and paired browser
adapter. No kernel, persistence, history or worker protocol version changes are required.

The domain owns `createEdgeReferenceProjector`, shared by the editor's selected-edge controls and
automation. It computes semantic-role and lineage-token uniqueness across the complete current edge
set before creating any reference. It retains only unique role/token material and the ordinary
geometric signature. The existing domain resolver determines whether each reference is resolved,
ambiguous or missing; the query does not invent a replacement for ambiguous geometry.

The application validates the document rebuild response, exact document/revision, complete feature
evaluation coverage, successful target, matching content hash and valid solid geometry. Construction
plane display geometry is ineligible. It verifies that distinct edge candidates cover the exact
shape's edge count; a protocol-valid but partial catalog fails as `invalid-geometry-evidence`.
Only domain candidate fields pass into trusted query evidence. Meshes, analytical display samples,
edge polylines, native acquisition keys and other worker payloads do not cross that projection.

## Query contract

The document core registers `org.vibeshape.model.edges`, schema version 1, as a derived cursor query.
The caller supplies an exact committed revision, feature ID, cursor and page limit. The browser
injects its paired document ID and obtains evidence from the captured persistent session's rebuild.
The query payload cannot supply geometry evidence.

The view returns document/revision, generation, rebuild request identity, feature ID, content hash,
classification, total edge count, next cursor and at most 100 edge entries. Each entry contains an
ordinary durable `EdgeTopoRef` and its current resolution status. Signature measures, centroids and
bounds use millimetres. Only a resolved entry is presently unambiguous. Query responses never contain
candidate IDs, tessellation face IDs, polylines or native hashes.

A cursor is an opaque object containing the source rebuild ID, feature ID and next offset. Clients
must return it unchanged. It is bound to the exact rebuild, not merely the semantic document revision:
a worker restart or same-revision rebuild can change evaluation-local ordering. A cursor from another
rebuild or feature returns `stale-geometry`; restart at the first page. The browser's document worker
issues a fresh request identity for every rebuild. The broker separately verifies document, revision
and requested feature on successful responses.

Evidence is bounded to the worker's existing 10,000-candidate limit. A response page is capped at
128 KiB; excessive signature data returns `query-result-too-large` and clients can reduce the limit.
The shared internal serialization counter also serves existing CAD and variable queries, preserving
their size policies. Missing, stale, malformed, failed, blocked and suppressed geometry produce typed
failures, never an invented empty successful model.

## Authoring and repair

Omitting `edges` explicitly selects the existing all-edge schema version 1 behavior. Supplying
1–256 durable edge references selects version 2; the ordinary feature handlers retain ownership,
cardinality and duplicate checks. The tool translator preserves references, labels, dependencies and
quantity expressions through existing registered feature add/update commands.

Updates replace supplied intent. To retain a selected operation, the client must read `model_entity`
and resubmit its complete reference array. Omission does not preserve a prior selected set: it selects
all-edge behavior. To repair lost intent, inspect the target's current edges and explicitly replace
the broken references. Exact preview checks the whole draft; an invalid selected reference cannot
reach browser commit review. A valid commit uses browser Apply, ordinary persistence and one Undo
transaction. Reopening restores the authored references rather than evaluation-local indices.

## Verification gate

Require real MCP clients to commit a box, inspect all twelve edges through one-entry pages, reject
stale queries, and create both selected Fillet and Chamfer. Compare one-edge treatment volumes with
independent formulas, commit through browser Apply, author a missing reference, reject preview/commit,
repair from inspected references, edit size, inspect retained schema-version-2 intent, then Undo and
reopen. Existing graphical/keyboard selected-edge workflows must pass because they share projection.

Unit contracts must cover cross-page ambiguity and unique lineage, stale rebuild cursors, wrong
document/revision/feature, bad cursors, incomplete or malformed evidence, duplicated candidates,
response budgets, broker result correlation, expression/reference preservation and all-edge
compatibility. Require workspace types, formatting, lint, production build and the changed-code audit.

Verification on 2026-09-07 passed:

- `bun run test --maxWorkers=4`: 1,749 tests in 217 files.
- One uninterrupted `bun run test:e2e` run with `--workers=3`: all 90 cases in Chromium,
  Firefox and WebKit. It covered `local-mcp`, `local-mcp-cad`, `local-mcp-variables`,
  `local-mcp-edges`, `local-mcp-cancellation`, `local-mcp-protocol`, `local-mcp-visual`,
  `automation-document-commit`, `automation-document-cancellation`, `automation-review`,
  `automation-draft-geometry`, `selected-edge-treatment`, `selected-edge-picking`,
  `selected-edge-worker`, `edge-treatment` and `edge-treatment-worker`.
- Full workspace typechecking, formatting, lint, production build, English/local-link checks and
  `git diff --check` passed.
- The changed-code Fallow audit exited 0 with the two previously investigated Bun override warnings.
  Build chunk-size and dynamic-import warnings remain release performance work.

Owner review identified incomplete edge catalogs and potentially unclear update wording. The final
projection verifies exact edge-count coverage; a regression rejects empty and partial catalogs.
Discovery explicitly requires resubmitting references to keep a selected update. The primary review
also identified same-revision rebuild paging as a risk: cursors now bind to the unique rebuild request,
and regression tests reject cursor reuse after rebuilding or changing the target feature.


## Remaining scope

This query inspects committed geometry only. A client must first commit new source geometry before
querying its edges. Draft topology/profile inspection remains necessary for richer single-draft
modeling. Independent constituent bodies, richer face/profile inspection, remaining named CAD
commands, durable tool provenance, additional part operations and local release gates remain open.
