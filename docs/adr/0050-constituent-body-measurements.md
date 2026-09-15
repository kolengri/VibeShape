# ADR-0050: Constituent body measurements

- Status: Accepted
- Date: 2026-09-08
- Extends: [ADR-0041](0041-revision-bound-model-measurements.md), [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md)

## Decision

Extend the existing domain measurement evidence, application projection, registered query, editor
measurement task, and local MCP adapter. No new workspace or persisted schema is introduced.

Keep `org.vibeshape.model.measurements` version 1 unchanged for whole-feature inspection and existing
preview consumers. Register `org.vibeshape.model.body-measurements` version 1 for exact body metrics.
The query registry currently supports one version per kind; a distinct kind preserves existing
clients without changing registry compatibility semantics.

Application derives body evidence from the same validated committed worker response as whole-feature
measurements. Evidence includes complete feature evaluation coverage and bounded body metrics;
meshes, topology candidates, and native objects do not enter this read model. Named roles require
valid positive-volume single solids and must match their producing content hash. Legacy aggregates
retain an omitted role; no constituent identity is invented. Complete evidence admits at most 100,000
body entries and 256 declared bodies per feature. Exceeding these limits reports unavailable evidence.
This read-model budget does not close the separate native pattern mesh-memory gate.

Extract pure terminal-body consumption into the domain and use it from both application geometry
projection and the body query. Successful nonempty consumers remove only their selected source roles;
failed, suppressed, and empty consumers preserve source bodies. Missing named roles fail closed.
The default query lists current terminal bodies. An explicit feature ID inspects its historical body
outputs; an optional output role requires that feature ID and resolves exactly, with no root or
sibling fallback. Failed or empty explicit outputs return diagnostics, not zero-valued body entries.
Construction-plane display geometry is not measurable.

Queries bind document ID and exact revision, use cursor pages of at most 200 entries (20 by default),
and cap serialized responses at 128 KiB. Output carries generation, content hashes, canonical
`mm`/`mm2`/`mm3` units, and exact body count. Trusted derived context is supplied by the application;
clients cannot submit it as query payload. Existing stale-generation and revision ownership remain
in force. Explicit role identity, rather than list position or face index, chooses a measurement.

The measurement panel uses the body query, preserves a selected body when opening the read-only
Measure tool, distinguishes siblings in its selector, and invalidates paging on document, revision,
feature, or role changes. The local read-only `model_body_measurements` tool exposes the same query
through the paired browser session. `model_info.measurements` keeps its existing whole-feature view.
No new command, draft mutation, confirmation policy, or unpaired document access is introduced.

## Required evidence

- Domain tests for exact role and legacy identity, complete catalogs, bounds, hash/feature coverage,
  sibling preservation, failed/suppressed/empty consumers, and no aggregate fallback.
- Application tests for full validated worker projection, missing/foreign/stale geometry, detached
  metrics without mesh/native payloads, and unchanged whole-feature measurement behavior.
- Query and MCP schema tests for exact selection, historical inspection, missing roles, stale
  revisions, bounded paging and bytes, paired access, and unchanged existing tool contracts.
- UI tests for different sibling values, exact selection, stale role failure, units, read-only
  operation, and paging reset; real-worker panel and paired MCP round trips in all three browsers.
- Regression evidence for the shared terminal-body projection used by rendering and export.

Per-copy topology and explicit reference repair remain separate Stage 2 gates in ADR-0049. This
increment does not deliver a native pattern producer or claim independent-copy CAD completion.

## Implementation evidence: 2026-09-08

The domain evidence, shared terminal-body projection, application builder, registered query,
measurement panel, and paired local MCP tool are implemented. Native worker responses supply the
metrics; the UI preserves an exact selected body when opening Measure. The broker validates the
paired document, requested revision, feature, and role before accepting a body measurement result.

Verification passed:

- `bun run test --maxWorkers=4`: 1,938 tests in 240 files in an isolated 30.60-second run.
  Subsequent test-fixture typing and UI-copy changes also passed their focused tests.
- Workspace typechecking, Biome formatting/lint, the changed-code Fallow audit, and production
  build. The MCP fixture's final type correction passed its workspace typecheck; the final browser
  fixture passed script typechecking. Existing bundle and dependency-override warnings remain.
- One uninterrupted `bun run test:e2e tests/e2e/model-measurements.spec.ts tests/e2e/local-mcp.spec.ts tests/e2e/body-output-worker.spec.ts tests/e2e/document-export.spec.ts tests/e2e/body-selection.spec.ts --workers=3 --trace=retain-on-failure`:
  all 24 cases passed in Chromium, Firefox, and WebKit in 1.3 minutes.
  This covers exact native metrics, body selection, unit conversion, edit/reopen, shared export
  projection, and the real stdio client inspecting current and historical bodies while rejecting
  missing roles, stale revisions, and unpaired access.
- After final output-label/count copy corrections,
  `bun run test:e2e tests/e2e/model-measurements.spec.ts --workers=3 --trace=retain-on-failure`
  passed all three browser cases in 34.1 seconds. Final light/dark screenshots were visually
  reviewed; the compact viewport assertions passed. Documentation language/local links and
  `git diff --check` also passed.

Review caught missing broker dispatch for the new response kind; a paired broker regression now
checks successful and mismatched responses. The first browser run then exposed an output JSON
Schema incompatibility for labeled bodies: intersecting a strict body schema with a label object
produced a schema the MCP client rejected. Extending the strict body schema preserves its validation
and produces a compatible advertised schema. An in-memory MCP client now validates an actual
labeled result, in addition to discovery annotations. The passing browser run followed both fixes;
the earlier interrupted run is not acceptance evidence.

Sibling measurement tests use explicit catalogs with distinct values. The two-body browser fixture
uses synthetic meshes and proves renderer selection, not native pattern production. Per-copy
topology, repair, and bounded native pattern memory remain open under ADR-0049.
