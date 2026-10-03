# Exact planar import authoring

`preparePlanarImport` accepts the strict parser result for SVG or DXF. It transforms the already
millimeter-normalized analytical paths once and returns a domain `PreparedPlanarImport` plus
analytical bounds. A failed path returns one explicit diagnostic; no partial authoring set escapes.
Source units, path order, labels, layers and closure are retained. Inspection IDs and ordinals locate
one source inspection; they are not persistent authored identity.

The worker applies an invertible affine transform of the source XY plane without projection or a
hidden Y-axis flip. Lines and cubic control poles transform directly. Quadratics are exactly
degree-elevated. Exact similarities retain circles; other conic transforms use orthogonal principal
axes and a parameter remap. The determinant/major-radius product recovers the minor axis without
subtracting nearly equal eigenvalues. Parameter rotation comes from the dominant row to avoid
minor-axis cancellation. Reconstructing both original axes must stay within `1e-8` mm; axes below
the `1e-7` mm topology tolerance or a minor/major ratio at most `1e-12` fail explicitly.

Signed secondary axes preserve reflection. A negative circular arc swaps its ordinary sketch start
and end because that entity has a counterclockwise parameter convention; its captured
`sourceDirection: -1` records the original traversal. Elliptical arcs may instead reverse their
secondary axis. Both choices preserve the exact source locus. Full-turn conics become full circle
or ellipse entities. Bounds include all eligible conic extrema and cubic derivative extrema.

`authorPreparedPlanarImport` validates this domain-owned contract and creates an ordinary fresh
SketchRecord on the explicitly supplied plane using the caller's captured UUID factory. It returns
the sketch, every created entity ID and per-path curve/point ID ownership. Endpoint junctions are
shared within each path at the existing `1e-7` mm tolerance; the first authored junction coordinate
is retained. Separate paths retain separate point identities. Ambiguous nearby junctions fail.
A single closed cubic retains distinct endpoint UUIDs at coincident coordinates because the cubic
contract requires four distinct role IDs. Imported curves remain unconstrained ordinary geometry;
profile extraction and solving retain their existing authority.

Collection lengths are checked before deep geometry validation. Capacity conservatively counts
each curve's defining points even when later junctions share IDs. It reserves the native frame and
requires fewer than 4,990 native entities, at most 10,000 parameters and 10,000 internal constraints before UUID
allocation. An elliptical arc accounts for up to 15 native entities, 18 parameters and 11 internal
constraints. This can reject an otherwise feasible sketch whose point sharing would reduce costs;
it never silently removes source curves. Nonfinite geometry, disconnected authored paths, invalid
closure and geometry or defining points outside +/-100,000 mm also fail.

Domain code does not depend on formats or an adapter. Root integration binds the source asset digest
and parser policy to these captured curve IDs, handles metadata and publishes the ordinary sketch
command. UI, saved source groups, restart, Undo/Redo, actual native solving and solid profile rebuild
are separate integration gates. These leaves do not make mesh sources into CAD curves.
