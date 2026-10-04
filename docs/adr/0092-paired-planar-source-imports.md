# ADR-0092: Paired planar source imports

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0065](0065-bounded-exchange-geometry-import.md),
  [ADR-0091](0091-paired-native-source-imports.md)

## Decision

Expose five distinct named SVG/DXF operations through the existing local and paired remote
transports: `begin_planar_import_upload`, `append_planar_import_chunk`,
`inspect_planar_import_upload`, `commit_planar_import_upload` and `discard_planar_import_upload`.
Reuse `readPlanarSource`, the disposable bounded parser worker, exact transform preparation,
analytical curve preview and `createPlanarImportTransaction`. Preserve native import contracts,
existing parsers, source provenance and ordinary editable Sketch semantics. No new kernel, parser,
caller transform, raw command, storage route or approval flag is introduced.

Begin captures the paired actor, committed document/base revision, safe leaf filename, byte
count, units, origin plane and label. SVG requires explicit physical units or px at 96 dpi; DXF
accepts declared units or a physical override. Plane is XY/XZ/YZ. The same 6 MiB source cap,
90 KiB decoded chunks, canonical base64/order/idempotent retry policy and five-minute idle expiry
apply. Beginning either import kind releases the other temporary source, keeping one bounded
source per browser automation handle. The private owned-byte append helper serves both kinds.
The editor's 32 MiB cap and existing parser/entity/path limits remain unchanged.

## Inspection, review and publication

Inspection computes SHA-256 from owned bytes and runs the existing parser and transform preparation.
It captures the source asset, Sketch, entity and path-output identities once using the ordinary
builder. Its bounded DTO exposes source units/scale, selected or declared policy, selected plane,
2D bounds, counts and captured Sketch/path identities. It has no body roles or solid measurements.
Normalization, policy, complete bytes and unique ordered paths are validated at the wire boundary.
Unsupported geometry remains the existing actionable diagnostic, without flattening or partial
Sketch publication.

Commit requires the exact inspected version and unchanged base. Reparse detached captured bytes
and compare the complete prepared analytical geometry, units and bounds before review. The
existing analytical SVG preview renders supported exact curves synchronously; manual Apply
requires a ready review and holds its async lock through persistence. Auto-apply does not approve
imports. Rejection, cancellation, expiry, stale context or changed inspection never publishes.
Accepted persistence remains authoritative after transport disconnect.

Only the captured browser factory receives the closed planar commit port. It checks an applying
review of kind `planar-import`, exact actor, upload/draft identity, version/base, source descriptor,
label, inspection and canonical transaction commands. The private guard excludes only the
transport's own automation-busy blocker and still reads every mounted editor/surface blocker.
Public guards and public authored transaction authority are unchanged.

The existing transaction builder accepts a trusted validated actor from that port, retaining the
ordinary user default for editor imports. Source assets and the editable Sketch commit atomically
through ordinary repository CAS, digest verification, rollback, publication, Undo/Redo and portable
asset closure. Import creates no Part. Saved solved profiles are rediscovered before an ordinary
downstream feature; existing source-binding behavior on later Sketch edits remains unchanged.

## Budgets and verification

A maximum transfer needs 69 appends and 73 calls including begin, inspect, commit and discard,
within the existing 128-operation remote lifetime. Encoded chunks fit 192 KiB work messages.
Clients pace the existing 30 operations/minute limit; no ordinary response or rate budget is raised.
Both transports validate response/upload/version/source intent correlation.

Verification covers strict input/DTO correlation, real SVG/DXF parsing and unit normalization,
actor ownership, defensive copies, expiry/retries/cancellation, stale and changed inspections,
manual review/persistence, unchanged ordinary editor actor defaults and the paired browser
source-to-editable-Sketch/profile/downstream export workflow. It does not establish arbitrary
SVG/DXF compatibility beyond the existing supported subset or external CAD interoperability.
