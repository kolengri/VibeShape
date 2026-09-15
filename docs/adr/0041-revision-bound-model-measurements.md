# ADR-0041: Revision-bound Model Measurements

- Status: Accepted
- Date: 2026-09-07
- Related: [ADR-0003](0003-parametric-dag-and-toporef.md), [ADR-0013](0013-microkernel-modules-and-mcp-automation.md)

## Decision

Extend the existing document query owner with `org.vibeshape.model.measurements` version 1. The
editor measurement task and later MCP resources consume the same registered, bounded query. Reading
measurements does not create a transaction, rebuild geometry, or change the active document.

The domain owns a pure derived-evidence schema. Application projects exact committed worker results
into this schema after validating the worker response, document ID, revision, complete feature
coverage, successful content hashes, finite metrics, and ordered bounds. Failed, blocked, and
suppressed evaluations remain explicit states without fabricated zero-valued geometry. Meshes,
topology candidates, native objects, and arbitrary diagnostic payloads never enter this read model.
Blocked-feature IDs are bounded examples inherited from the evaluator; their list does not claim
completeness.

The query dispatcher accepts an optional trusted derived-evidence context. The caller cannot supply
that context through a query payload. Automation adapters must acquire it from the application port.
The query repeats schema, document, revision, and feature-coverage checks and returns unavailable or
stale diagnostics instead of silently using older geometry. Worker generation and feature content
hashes accompany successful values as derived provenance, not persistent body identity.

The default result enumerates terminal feature outputs using the same domain body-consumption policy
as the viewport. An explicit feature ID can inspect an earlier output. Each output may contain
multiple solids; measurements then describe that complete feature output. No union volume, density,
mass, or independently addressable constituent-body identity is inferred. Datum planes are excluded
from the default terminal-output set. Explicit datum requests fail with `feature-not-measurable`: the
kernel plate used to display a construction plane is not a measurable model body.

Responses carry canonical `mm`, `mm2`, and `mm3` units. The editor converts length, area, and volume
using the document display unit with the corresponding first, second, and third power of its scale.
Every page contains at most 200 feature entries (20 by default), an exact total, and a revision-bound
cursor. Internal evidence may cover the document's 100,000-feature limit; external pages remain
bounded. A changed document requires a fresh query and invalidates paging state in the editor.

## Boundaries and compatibility

No new workspace or persisted schema is introduced. Domain remains independent of protocol and
application packages. Application depends on domain/protocol; automation API depends on domain;
the web composition owns their connection. Existing semantic queries keep their two-argument call
shape, and derived queries without application evidence fail closed. This decision does not accept
the remaining MCP transport, pairing, preview, or mutation policy from ADR-0013.

## Required evidence

- Exact box and curved-solid measurements from the real worker through the product query and panel.
- Stale document/revision, unavailable geometry, malformed bounds/metrics, hash mismatch, and missing
  or foreign feature rejection; explicit failed, blocked, and suppressed states.
- Bounded pagination and omission of consumed history inputs from current body outputs.
- Length/area/volume conversion, independent per-output values, and no double-counted model total.
- Read-only operation, edit/rebuild/reopen freshness, keyboard access, compact layout, and both themes.

Point/edge distances, angles between references, center of mass and inertia, independent constituent
body selection, printability analysis, and richer diagnostic resources are separate increments.

## Validation

The measurement delivery passed 1,625 unit tests in 198 files, full workspace typechecking, Biome
format/lint, the changed-code Fallow audit, and the production Vite build. The real-worker measurement
workflow passed in one Chromium/Firefox/WebKit run: box and cylinder metrics, independent output
selection, parameter edit, project-unit conversion, and reopen. Screenshots cover both themes and a
512 CSS-pixel compact viewport representing a 1024-pixel window at 200% browser zoom; controls and
values remain reachable through the scrollable panel. Contract/UI regressions reject construction
plane display metrics and cover actual ready-to-stale/saving/loading transitions.

This evidence accepts the measurement read path only. It does not close exact automation preview,
MCP transport, the complete CAD workflow matrix, or installed-build performance/recovery gates.
