# ADR-0112: Multi-sketch Extrude

- Status: Accepted
- Date: 2026-10-19
- Extends: [ADR-0034](0034-versioned-multi-profile-feature-input.md), [ADR-0036](0036-multi-profile-modifying-extrusion.md)

## Context

Extrude previously accepted several regions only when they belonged to one sketch. Selecting another
sketch replaced the existing task input, and the saved-profile picker always replaced its selection.
Users need one Extrude to consume explicitly selected profiles from several sketches, including
parallel offset and nonparallel support planes.

## Decision

Register Extrude schema version 8. Versions 1–7 retain their existing schemas and saved semantics;
Revolve retains its one-sketch restriction. Cross-sketch creation or an explicit edit promotes the
Extrude through the ordinary feature command. No document-file migration is required.

The existing canonical `SketchProfileSet` retains the 64-profile and 2,000-boundary-occurrence budgets.
Each selector resolves against its own source sketch. Every unique sketch is a semantic input and a
document-graph dependency, and is solved once per rebuild. Support references are deduplicated by
complete stable identity in canonical selector order. Dependencies contain the exact modifying target
first, distinct sketch-support producers next, and any distinct dynamic-end producer last. At most 66
producer slots and 64 support references are admitted by this feature version.

The document worker materializes exact analytical profiles in their own resolved support frames.
It does not project nonparallel profiles onto a common plane or approximate curves with polygons.
Distance, second depth, reverse, symmetry, signed start offset, and draft are shared authored parameters
applied relative to each profile's own frame and normal. Dynamic endpoints retain one exact named body
or face binding but resolve distance and end-plane geometry independently per support frame. Missing
profiles, unresolved supports, stale endpoints, unreachable or parallel end faces, and incomplete
coverage fail the entire feature; no selected profile is omitted.

The geometry worker creates one disposable tool per profile and combines tools in canonical order,
then executes one operation against the explicit modifying target. New retains the bounded one-to-many
solid invariant. Add, Remove, and Intersect retain the single valid positive-volume solid invariant.
Failure preserves the previous valid result and releases temporary tools. V8 results use conservative
geometric topology candidates rather than first-frame extrusion role heuristics.

While an Extrude task is active, ordinary and Shift viewport clicks toggle profile membership. The
saved-profile picker also toggles and resets its displayed choice so the same region can be picked
again. The field names each sketch and region, exposes a visible selection action, and supports
individual removal and clearing. Apply remains one revision-checked command and Undo entry.

The existing MCP Extrude tools accept cross-sketch intent using the complete advanced typed parameter
record and select v8. Face-extent tools retain v7 for one-sketch inputs and select v8 for cross-sketch
inputs. They share document validation, preview, and command authority with the editor.

## Consequences

- Sketch and support edits invalidate all affected Extrude content, including later selected sketches.
- Selection order does not change authored identity, tool order, or cache identity.
- Different sketch normals can produce overlapping, connected, or disjoint tools; New may produce
  several solids, while an invalid modifying result still fails closed.
- V8 does not add stable per-solid output identity or automatic repair of topology references.
- A single end face may be meaningful for some sketch normals and unreachable for others. The full
  feature must pass exact preview; an endpoint failure does not silently become a distance extrusion.

## Verification

Domain tests cover strict old-version reads, v8 round-trip intent, complete semantic inputs, support
ownership and cycles. Worker tests cover analytical materialization, per-sketch solve reuse, missing
profiles and independent dynamic ends. Actual OCCT tests cover perpendicular, parallel offset and
reflected frames, bounds, volume, solid count, modifying operations, cache retention and disposal.
Browser coverage exercises picker and viewport toggles, exact preview, Apply, Undo/Redo and reload.
