# ADR-0044: Local MCP CAD Authoring and Inspection

- Status: Accepted
- Date: 2026-09-07
- Related: [ADR-0043](0043-local-stdio-mcp-browser-session.md), [ADR-0042](0042-exact-automation-draft-application-path.md)

## Decision

Extend the existing paired local adapter with six named draft tools: `create_sketch`,
`update_sketch`, `create_extrude`, `update_extrude`, `create_revolve`, and `update_revolve`.
Add `model_tree` and `model_entity` for revision-bound inspection of the paired committed document.
This increases discovery from nine to seventeen tools. No new geometry, persistence, arbitrary
command execution, or extension authority is introduced.

Shared tool schemas remain in `packages/automation-api`. Browser command translation uses ordinary
registered sketch add/update and feature add/update handlers. Those handlers retain authority over
expressions, dependencies, profile validity, and feature eligibility. Exact draft preview, browser
review, original-command replay, ordinary persistence, and one-transaction Undo retain ADR-0042's
contracts. The server never constructs or owns a document snapshot.

## Authoring contract

Every mutation requires a draft ID, current draft revision, and fresh UUIDv7 command ID. Sketch
tools accept the complete existing sketch record schema: entities, constraints, plane, and supported
references. Updates retain stable IDs and preserve unaffected authored data. They replace the supplied
record rather than applying an implicit merge.

Extrude and Revolve tools accept explicitly typed authored parameters, feature ID, optional label,
ordered dependencies, references, and suppression. They support the current single- and multi-profile
parameter families, including New/Add/Remove/Intersect. The adapter selects the matching existing
feature schema version. It never guesses an operation target, a profile, or a topology reference.
Modifying operations require the target first in dependencies; origin, sketch-line, and model-edge
Revolve axes follow the ordinary domain rules. Distances use typed length quantities and angles use
typed angle quantities with canonical millimetres/radians. The shared domain schema remains the
source of truth for supported expressions and limits.

Invalid schema input fails before dispatch. Geometrically impossible intent can remain in a draft
for correction; preview reports invalid geometry and commit is refused. Changes to a sketch rebuild
its dependent features through the same worker path used by the editor.

## Inspection contract

The document core registers `org.vibeshape.cad.inspection.list` and
`org.vibeshape.cad.inspection.detail`, both version 1 semantic queries. `model_tree` maps to list and
returns at most 100 summaries per page, in stored feature order followed by stored sketch order.
Each summary includes kind, stable ID, type, schema version, optional authored label, and dependencies.
Typed CAD readers supply sketch/profile relations, including multi-profile features; arbitrary
lookalike parameter fields do not invent dependencies. An opaque numeric cursor is valid only for
the exact requested revision.

`model_entity` maps to detail and returns one complete authored sketch or feature record selected
by `{ kind, id }`. Both tools require the committed revision; the browser injects its paired document
identity. The dispatcher rejects stale revisions, other documents, absent entities, and bad cursors.
The broker independently matches successful results to document, revision, and requested entity.
Inspection exposes semantic records, not kernel handles, event history, another project, or derived
geometry masquerading as authored input. Names and labels are untrusted model data.

List and detail responses are capped at 128 KiB. List projection only visits the requested source
page; excessive dependency summaries or serialized data produce `query-result-too-large`.
Clients can reduce page size, but records exceeding the detail cap require a future paginated entity
contract. Large sketches are therefore not fully editable through this transport yet.

Each serialized tool operation is limited to 192 KiB before queuing. This reserves poll-envelope
space within the browser's 256 KiB response cap while preserving the server's 256 KiB stdio input
bound. An oversized operation returns `operation-too-large` and leaves the paired session usable.
Preview is not advertised as read-only or idempotent because successful preview renews the draft's
expiry, even though it does not mutate the committed model.

Quantity normalization uses Zod's type-preserving `overwrite` for negative zero, following
[the Zod 4 contract](https://zod.dev/v4#overwrite). This preserves numeric JSON Schema metadata while
retaining finite-number validation and canonical zero behavior. The adapter builds all discovery
schemas before opening its HTTP listener, so schema-generation failure cannot leave a listening
server that never initializes MCP.

Discovery extracts repeated schema definitions into local JSON Schema references. A direct
measurement of the seventeen tool input/output schemas reduced their serialized size from 273,956
to 167,595 bytes, without removing supported constraints or parameter alternatives. Real-client
validation must continue to resolve these references correctly.

## Verification gate

Require real stdio clients to create and repair a sketch-backed Extrude, inspect its persisted
records, update sketch dimensions and extrusion depth, validate independent exact volumes, commit
through browser Apply, Undo, and reload. A separate Revolve case must verify full and partial angles
against independent cylinder volumes. Run these paths in Chromium, Firefox, and WebKit.

Contract tests cover feature version selection, authored parameter preservation, malformed sketches,
invalid dimensions/angles, stale and mismatched inspection results, bounded pagination, unknown
feature lookalikes, multi-profile dependencies, and oversized operations without session loss.

Verification on 2026-09-07:

- `bun run test --maxWorkers=4`: 1,711 tests in 213 files passed. The unrestricted concurrent run
  hit two existing five-second test timeouts; bounded workers passed without changing those tests.
- `bun run test:e2e tests/e2e/local-mcp-cad.spec.ts tests/e2e/local-mcp.spec.ts --workers=3`:
  all nine real-client cases passed across Chromium, Firefox, and WebKit.
- The final affected matrix (`local-mcp`, `local-mcp-cad`, `local-mcp-cancellation`,
  `local-mcp-protocol`, `local-mcp-visual`, `automation-document-commit`,
  `automation-document-cancellation`, `automation-review`, and `automation-draft-geometry` specs,
  using `bun run test:e2e` with `--workers=3`): all 60 cases passed across the same three engines.
- `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run build`: passed.
- `bun run fallow:audit`: exit 0 with the two previously investigated Bun override warnings.

The real-client tests wait for the committed Undo revision before reloading. Review waits account
for the exact kernel rebuild preceding the UI, rather than treating a five-second locator default
as a geometry-performance requirement. Dedicated release performance gates remain open.

## Remaining scope

This expands existing CAD coverage; it does not complete the local CAD/MCP release. Named Chamfer,
selected-edge repair, variables, other primitive/boolean/reference tools, richer profile/topology
inspection, draft record inspection, tool-level durable provenance, installed/offline lifecycle,
performance characterization, and the broader CAD workflow matrix remain separate work. No new
interoperability certification is implied by reusing existing export tools.
