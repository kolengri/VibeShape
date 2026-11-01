# Sample motion clearance

Use `model_assembly` to identify the committed joint and occurrence IDs, then
`inspect_motion_clearance` on local or paired remote MCP with explicit `projectId`, committed
`revision`, `jointId`, `coordinate` (`angle` or `translation`), `start` and `end`.
Angles are radians; translation, distance and `minimumGap` are millimeters. This operation uses
the same inspector as the editor with a bound project capture, disposable assembly previews and
exact frozen-source geometry. It never applies a pose or changes the saved assembly or selection.

`sampleCount` defaults to 13 (2–64), including both range endpoints. A nonzero range is required.
Omit `minimumGap` to use the bound authored print-fit tolerance (0.2 mm fallback when absent); the result echoes the effective threshold. `pairs`, when supplied, lists
unique distinct `leftInstanceId`/`rightInstanceId` pairs, up to 32. The total pair-pose budget is
1024. Without pairs, the inspector chooses all unordered occurrence pairs within its bounded
admission rules. Prefer explicit relevant pairs for larger assemblies. `budgetMs` defaults to
120000 (100–120000); reducing it can produce an incomplete report.

Check `status` first. `complete` establishes sampled evidence for the requested range only.
`incomplete` plus `reason` never establishes a pass: unsupported mesh sources, unavailable exact
distance, failed solves, missing evidence, budget, stale source and cancellation must be reported.
A protocol failure is also not a pass. Do not retry stale inputs without reading fresh authority.

The bounded report contains actor/document/revision/source digest provenance, actual threshold,
`resolution`, requested sample count, measured pairs, per-sample value and solved `poseDigest`,
minimum pair/distance/positive collision volume, collision counts, below-gap counts and the overall
`smallest` sampled pair/value. Positive volume means an exact collision even if the sampled gap is
zero. A zero gap with zero volume can be contact; compare against the requested threshold.
The pose digest is a receipt for the solved sampled geometry, not closest-point coordinates.

`coverage: "sampled-poses-only"` is an explicit limit: collisions or smaller gaps can exist between
samples. Never describe a complete report as collision-free throughout the range, continuous
collision detection, manufacturability or physical-fit proof. Stop or disconnect cancels the
operation; revision, source or actor changes cannot reuse its authority.

Keep the client request open for up to two minutes and do not resubmit concurrently. A client
timeout cancels the operation; inspect fresh project authority before retrying.
