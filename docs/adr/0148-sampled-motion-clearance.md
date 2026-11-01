# ADR-0148: Sampled motion clearance

- Status: Accepted
- Date: 2026-11-02
- Extends: [ADR-0113](0113-assembly-motion-studies.md), [ADR-0129](0129-revision-scoped-assembly-inspection.md)

## Decision

Extend joint Drive with a bounded clearance sweep. UI and paired automation share one inspector
over the existing disposable assembly solve and frozen-source materialization. Capture document,
revision, authenticated actor, joint, coordinate, range, sample count, optional instance pairs,
minimum gap and budget. Units are radians and mm. Default minimum gap uses authored print-fit
clearance when available, otherwise 0.2 mm.

Each sample solves the actual assembly first. Exact distance uses OCCT
`BRepExtrema_DistShapeShape` on transformed native solids. Positive-volume interference uses the
existing exact Boolean intersection. Bounds cannot replace exact distance. Mesh sources,
unavailable sources, invalid solves and missing evidence never become a clear pass.

Include both exact endpoints. Limits are 2–64 samples, 32 explicit pairs, eight instances for
implicit all-pairs selection, 1,024 pair checks and 120 seconds. Results retain source and solved-pose
digests, sample coordinates, distances, intersection volumes, gap violations and the smallest
sampled gap. Cancelled, stale, unsupported, failed or budget-limited runs are incomplete; successful
partial samples do not complete a sweep.

A completed sweep covers requested samples only. The smallest sampled gap is not a mathematical
minimum over a continuous path. Clear samples do not establish collision-free unsampled motion.
UI and automation state resolution and this limitation. No continuous collision detection,
contact response, physical dynamics or manufactured-fit guarantee is introduced.

Show revalidates source and solved-pose digests before displaying an ordinary disposable preview.
Explicit Apply retains the existing guarded joint update and one Undo entry. Inspection never
implicitly applies a pose. Automation binds to its own project runtime, not the active editor.

## Consequences

Geometry tests cover separated, touching, overlapping and unsupported sources. Inspector tests
cover endpoints, budgets, missing evidence, source changes, cancellation and failures. Browser
acceptance checks report, Show, unchanged saved authority and explicit Apply/Undo. Local and remote
schemas enforce result provenance separately from computation validity. See the
[assembly workflow](../product/assembly-workspace.md) and
[operator reference](../../.agents/skills/vibeshape-inspection/references/motion-clearance.md).
