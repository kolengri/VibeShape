# Print readiness and fit clearance

**Prepare print** creates an oriented disposable print copy. Its **Print readiness** panel checks
that copy with editable minimum sampled wall thickness in millimeters and maximum overhang from
vertical in degrees. Analysis excludes generated support fins. It preserves design coordinates,
History, document variables and the selected print orientation. A face placed on the bed creates
a new print copy and invalidates the prior report.

Thickness casts one inward ray from each triangle centroid through the same body's BVH. The
nearest intersection is the local normal-ray thickness: exact for parallel walls, approximate
elsewhere. Thin samples appear red, unsupported downward triangles amber, and overlaps purple.
Bed contact requires the complete triangle to lie at the shared print bed height; a floating body
does not gain its own bed. A result reports sampled areas and minimum thickness, never a certified
global wall minimum, absence of self-intersections, slicer acceptance, or physical printability.

Closed edge topology and outward winding are checked after welding exact face-local duplicate vertices.
Open, reversed, degenerate, unmeasured, empty or over-budget evidence yields **unknown**, even if
other samples have no findings. Each body has a 100,000-triangle and 300,000-vertex budget. Host
schedulers yield between 256-triangle ray batches. BVH construction and topology validation are
synchronous within that budget. Cancellation and changed source/thresholds discard pending results;
the panel exposes an accessible pending state, progress and Cancel action.

Local MCP, paired remote MCP and the browser assistant expose `analyze_print_readiness`. Supply the
saved revision and explicit X/Y/Z print rotations in degrees; rotations apply X, then Y, then Z,
before centering XY and seating the shared lowest point on the bed. Thresholds default to 0.8 mm
and 45 degrees. The browser analyzes the current committed mesh and returns bounded per-body
counts, areas, sampled minimum and unknown coverage. Geometry stays in the browser. Both transports
check the echoed document/revision, orientation and thresholds. Source changes during computation
reject the report. No document is saved. An over-budget source leaves all bodies unknown rather
than preparing a potentially unbounded export solely for analysis.

## Shared fit allowance

The **Print fit clearance** tab in **Variables** explicitly creates or updates the ordinary length variable
`tolerance`. Tight, Normal and Loose are editable example radial allowances of 0.1, 0.2 and 0.3 mm;
they are not printer calibrations. Each preset saves through the existing revision-checked variable
table command and creates one ordinary Undo entry. Arbitrary length expressions, unit conversion,
usage inspection, reference protection, Undo/Redo and portable Save/Open remain owned by Variables.
No variable or feature value is silently inserted into older documents.

Hole fit presets write expressions such as `4 mm + 2 * #tolerance`; the allowance is radial, so the
diameter grows twice. Thread metric presets retain `#tolerance` in their radial clearance when a
valid nonnegative shared length exists. **Use #tolerance for radial thread clearance** links an
existing thread only on activation. Opening a feature preserves its existing values. Numeric or
unrelated expressions remain independent. MCP uses the existing variable draft operations and
ordinary quantity expressions; no separate settings authority is introduced.

## Source attribution

Centroid inward-ray thickness, downward-normal overhang classification and the radial fit convention
were adapted from [Extrudo](https://github.com/zoltanf/extrudo), revision `c05d910`, especially
`apps/web/src/print/thickness.ts`, `apps/web/src/print/overhang.ts` and
`packages/core/src/tolerance.ts`. Copyright (c) 2026 The Extrudo contributors. Those sources and this
adaptation are GPL-3.0-or-later, covered by the repository's [GPL license](../../LICENSE). No Extrudo
branding, name artwork or kernel implementation is included.
