# ADR-0064: Modeled custom threads

- Status: Proposed; domain, protocol, and native leaf implementation, product integration pending
- Date: 2026-10-03
- Extends: [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md),
  [ADR-0055](0055-trusted-exact-body-placement.md)

## Decision

Thread is a trusted first-party solid modifier, schema version 1, with one exact `BodyReference`
matching its sole feature dependency. The selected body role and source content hash belong to
canonical input identity; document UUIDs are excluded from numeric parameters. Ordinary part
modifier, preview, command, history, and native export owners integrate this leaf. No new package,
cosmetic representation, face index, automatic axis inference, or independent modeling path is added.

The feature cuts a custom 60-degree V groove. `external` defines the crest radius as
`nominalDiameter / 2 - clearance`, then cuts grooves inward by `depth`. `internal` defines the bore
radius as `nominalDiameter / 2 + clearance`, then cuts grooves outward by `depth`. Clearance is a
radial length, not a diametral value. External material above the crest radius is removed throughout
the threaded band; internal bore clearance is removed throughout that same band. Each helical
start must additionally remove effective material. Clearance alone cannot produce a successful
Thread result. This contract does not represent an ISO/DIN thread or certify a standard fit.

The axis is the positive world X, Y, or Z axis through an explicit authored origin. The origin is
axial position zero. Right-handed local frames are X: radial +Y, Y: radial +Z, Z: radial +X. Positive
phase rotates right-handed about the positive axis. A right-handed helix increases its angle with
positive axial distance; a left-handed helix decreases it. Phase at the start of the threaded band
is `phase + 2*pi*k/starts`. Lead is `pitch*starts`; pitch is the axial spacing between adjacent
starts. Count `starts` is an integer from 1 through 4.

`runIn` and `runOut` are nonnegative unthreaded axial allowances. The modified band is exactly
`[runIn, length-runOut]` relative to the origin. They do not create smooth tapers. A V profile is
expressed in the radial/axial plane, with axial half-width `depth/sqrt(3)`. The cutter is extended
past each band end. The source is partitioned at the band planes before subtraction; raw cutters
retain their extended end profiles. End boundaries are abrupt.
No source material outside the authored band is modified.

All dimensional inputs use existing quantity expressions and resolve to canonical millimeters,
radians, and scalars. Nominal diameter and length are positive and at most 1,000 mm; pitch is
0.2 through 20 mm; depth is positive and at most 0.75 times pitch. External root radius remains
positive after clearance. Origin and resulting world geometry remain within +/-100,000 mm.
The band must be positive and its length divided by pitch must not exceed 16, equivalent to the
sum of authored turns over all starts. Cutter overrun adds less than one further total turn across
all starts. Kernel tolerance can reject otherwise schema-valid extremely small dimensions.
The initial 64-turn proposal exceeded the measured prototype corpus: a one-start external cylinder
took about 3 seconds at 8 turns, 6 seconds at 16 turns, and 22 seconds at 32 turns; 64 turns failed
native pipe construction. Those measurements precede the checked band-first pipeline. With the
final pipeline, a local 10 mm diameter cylinder with 2 mm pitch and 16 total authored turns took
34.5 seconds with one start and 43.9 seconds with four starts. Both returned one valid body and
preserved the source; each ran in an isolated subprocess with a 60-second deadline. The single-start
result reuses its independently validated cut instead of repeating identical native operands.
Native calls remain synchronous. This structural authoring bound is not a latency guarantee for
arbitrary target geometry, and upper-bound previews can take tens of seconds.

## Native ownership and failure

The pinned generated declarations and actual WASM exports define constructor and overload arity.
A helix is a bounded 2D segment on the surface handle obtained from a native cylindrical face.
Only the surface and curve handles are owned; pointers returned by `get()` are borrowed.
`BRepLib.BuildCurves3d_2` creates the spatial spine. A closed triangular profile is swept with
`BRepOffsetAPI_MakePipeShell`, Frenet mode, and `Add_1(profile, false, false)`. Orthogonal profile
correction is disabled because it changes the authored axial profile. Current upstream
[OCCT documentation](https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_pipe_shell.html)
explains these flags; it does not replace the repository's pinned binding signatures.
The sweep uses one canonical phase; an owned rigid rotation applies each authored start phase.
Booleans use a canonical local Z frame and configure non-destructive mode before their explicit
build. A radially padded axial slab covers the entire canonical source bounds, including fins or
other protrusions beyond the nominal thread radius. The original copied source is partitioned into
its authored band and all material outside that band. The outside partition may legally contain
zero or several solids; every piece is retained. Clearance tools extend strictly past both band
planes by one pitch, exceeding the complete raw groove axial envelope under the depth bound.
Coincident allowance and swept profile caps otherwise produced a false partition for a phase-zero
single start. One native cut applies clearance and all raw, un-clipped grooves to the original band.
The threaded band is fused with the complete untouched outside partition, then returned to world
coordinates and validated as one body. No finite shard is discarded and no shape healing is applied.

A clearance-only result establishes the baseline volume. Each start is independently cut together
with the raw clearance tool from the original band, then must decrease that baseline by more than
`2 * Precision.Confusion() * bandSurfaceArea`. The surface area uses native B-Rep properties.
This conservatively budgets independent Boolean boundary differences and rejects volume drift as
effective material removal. The final combined cut must also decrease the baseline and leave no
positive-volume groove residual.

The original-band input is intentional: with the pinned kernel, an external two-start cylinder at
phase `pi/3` produces a false-empty `Common(clearedBand, rawSecondGroove)`; a single-tool cut of the
already cleared band removes only numerical drift. The same raw second groove cut together with
clearance from the original band removes real material. Clipping or fusing the cutters before the
source cut also lost a start or created a disconnected shard. Band-first source partitioning avoids
coincident cutter caps while preserving the authored geometry.

The cached source is deep-copied before any Boolean operation. Every acquired wrapper and shape
has one explicit scope owner. Cleanup runs in reverse acquisition order and continues after a
failed destructor. A result is transferred only after temporary cleanup succeeds; cleanup failure
withholds and releases that result. A cached source alias is never acquired or deleted.

Source, raw groove cutters, intermediate partitions, and resulting bodies are validated. Every published
result is one valid positive-volume solid with effective helical removal, finite world bounds,
and no native geometry shared with its cached source. Missed bands, invalid or disconnected
results, failed sweeps/Booleans, out-of-budget input, and cleanup failure reject the complete
operation. There is no partial Thread result.

## Verification boundary

The leaf corpus covers quantity dimensions, expressions, cross-field limits, exact dependency
binding, canonical numeric content, and strict protocol parsing. Native invariants cover external
cylinders and internal rings, signed handedness, explicit phase and origin, X/Y/Z frames, multiple
starts, real radial clearance, axial profile geometry, clipped end bounds, source preservation,
and injected acquisition/disposal failures. These run against the pinned WASM kernel.

UI create/edit/preview/Apply/Cancel, persisted ordinary commands, stale/missing body rejection,
undo/reopen/export, engine ownership accounting, and independent integrated review remain product
integration gates. No physical print or fit claim follows from kernel tests.

The native success boundary includes the X-axis external two-start case with phase `pi/3` and its
canonical Z counterpart. Every intended start is checked with a real material probe, alongside
retained material between starts, full unthreaded slab volumes, source preservation, radial
protrusions, and the zero-outside-partition branch. B-Rep validity and volume alone are insufficient
to accept modeled threads. Final product acceptance remains with the integration owner.
