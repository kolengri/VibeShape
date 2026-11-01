# ADR-0145: Bounded F3D source import

- Status: Accepted
- Date: 2026-11-01
- Extends: [ADR-0067](0067-captured-exact-source-imports.md), [ADR-0091](0091-paired-native-source-imports.md)

## Decision

F3D extends the existing geometry import owner. `packages/formats/f3d` reads ZIP
and binary design/ASM records in a disposable browser worker. The reader and STEP
writer are adapted from Extrudo's GPL-3.0-or-later source at commit
`c05d910395f514f4810d3fc76504ce6bb1c73da8`; retained attribution and separate
specification licensing are documented in its [notice](../../packages/formats/src/f3d/NOTICE.md).

Recovered visible body geometry is converted from internal centimeters into
millimeter STEP, then goes through the existing OCCT closed-solid validation,
measurement, tessellation and review. The durable immutable source is the
recovered STEP, with its own computed digest and complete stable output manifest.
The selected F3D bytes have their own upload digest; those identities are never
interchanged. The source filename retains `.f3d`. Original F3D bytes are temporary
and are not retained as a native editable Fusion backup.

Supported untransformed XY sketches containing nonconstruction lines/full
circles become native editable Sketch records. Numeric user parameters become
independent native variables with evaluated values and collision-resistant names.
Fusion expression syntax is never evaluated or translated into executable code.
Original constraints, dimensions and links are reported as unsupported. A plain
one-sided new-body circular extrusion can become a native feature only if its
single recovered body matches the decoded analytic cylinder's volume, area,
centroid, bounds and topology counts. All other supported solids use captured
exact-body fallback. Unsupported records and unrecoverable bodies are explicitly
listed; absence of any supported visible body fails preparation. Component
occurrences and body moves fail explicitly because this port does not apply their
placements; importing misplaced local bodies would be incorrect.

The ordinary revision-bound transaction inserts authority upgrades, variables,
sketches, captured source assets and the final feature atomically. Apply creates
one Undo entry. UI cancellation and failures do not publish a partial design. The
MCP upload tools expose the same worker preparation, report and ordinary review
path; external clients still require the existing browser approval.

## Bounds and verification

F3D source bytes are capped at 64 MiB in the editor, 6 MiB over MCP. Existing MCP
90 KiB chunks and session/transport limits are unchanged. ZIP limits are 4,096
entries, 256 MiB per expanded entry, 512 MiB total expanded declarations and a
200:1 expansion ratio. Zstandard requires one bounded window/frame without a
dictionary. Directory extent, paths, duplicate names, encrypted/split archives,
local-header agreement, overlaps and checksums are validated. Only required
streams are decompressed. Record walks and operation-table scalar reads have
explicit work budgets; the worker terminates after 30 seconds.

Tests cover synthetic encoded records, malformed/truncated/nonfinite records,
archive corruption and limits, ASM/B-rep topology and STEP writing, conservative
mapping, promotion/mismatch, upload contracts, strict transactions and the real
browser Worker -> OCCT preview -> report -> Cancel/Apply -> backup -> atomic Undo
flow using a synthetic license-safe archive. This does not establish universal
Fusion compatibility, source application round-trip, all assembly placements or
physical print acceptance.
