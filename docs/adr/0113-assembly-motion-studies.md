# ADR 0113: Assembly motion studies

- Status: Accepted
- Date: 2026-10-19
- Extends: [ADR 0080](0080-general-assembly-mates-and-topology-bound-frames.md), [ADR 0089](0089-owned-assembly-and-library-mcp-drafts.md)
- Worker/source lifecycle superseded by: [ADR 0129](0129-revision-scoped-assembly-inspection.md)

## Decision

Extend existing assembly authority with optional named motion studies. An absent collection stays
absent when an old document is parsed or replayed. Study records have their own schema version,
stable UUIDv7 study and track identities, duration in seconds, and tracks targeting a stable joint
and an angle or translation coordinate. Values use radians and millimeters. Keys have strictly
increasing times within the duration. Evaluation uses linear interpolation and holds the first and
last key outside their interval. Duplicate tracks for one joint coordinate are rejected.

Evaluate every track at the same requested time before solving. Two cylindrical coordinates merge
into one joint replacement. Missing joints, changed coordinate kinds and values outside authored
limits fail explicitly. Removing or editing a referenced joint must preserve the study invariants,
or repair/remove its tracks in the same ordinary assembly transaction. Study authoring does not
apply its pose. Applying a solved pose is a separate revision-checked assembly transaction and Undo
entry. Saving a study uses the same captured command/event and archive authority as other assembly
records; it creates no new storage or solver authority.

Timeline preview uses the existing exact disposable assembly preview. Requests are serialized;
seeking cancels previous work and ignores late results. Pausing retains the last successfully solved
pose and its matching time. Reset, revision changes and workspace disposal revoke pending results.
Playback permits reverse direction, bounded sample counts, relative speed and cancellable looping.
The first loop cycle solves at most 256 poses and retains at most 64 MiB of mesh buffers; subsequent
cycles replay those exact receipts without creating more workers or materializing sources again.
Speed controls the delay between poses and promises no frame rate or real-time physics. Initial
sampling still pays the existing disposable worker/source-resolution cost per distinct pose.
Contact response, gears, cams and additional mate kinds remain separate solver capabilities.

Sample exports contain only successfully solved occurrences at their recorded times. JSON and CSV
use canonical units and include revision identity; point traces transform a chosen local source
point through each actual solved geometry frame. PNG frame sequences reuse the existing bounded
model-preview renderer with one fixed camera and are delivered as a ZIP. PNG export does not imply
GIF encoding, collision clearance, physical motion or manufacturing evidence.

## Consequences

- The domain owns key interpolation, identity/budget validation and simultaneous drive updates.
- Workers retain exact geometry and closed-loop solving; animation introduces no second kernel.
- UI and MCP study authoring reuse ordinary assembly drafts, preflight, review and persistence.
- Sampling cancellation and solver failure publish no partial authored state. Exported partial
  successful samples remain explicitly identified as samples rather than a completed simulation.
- Verification covers exact endpoints, interpolation, simultaneous cylindrical drives, missing and
  changed joints, limits, old files, command replay/Undo, cancellation, stale seeks and solved exports.
