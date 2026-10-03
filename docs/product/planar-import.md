# DXF and SVG sketch import

**Import sketch…** opens a read-only inspection task for one DXF or SVG file. Select the source
length policy and an XY, XZ or YZ sketch plane, then choose **Inspect sketch source**. The preview
shows the prepared analytical curves, separate path and closed-path counts, source scale and
millimeter bounds. Inspection runs in a disposable module Worker and does not publish source assets,
sketches, Parts or history. Cancel terminates pending inspection and leaves the document unchanged.

SVG requires a selected user-unit policy. Pixels use 96 dpi; supported physical choices are
micrometers, millimeters, centimeters, meters, inches and feet. Explicit SVG viewport lengths,
viewBox placement and nested affine transforms remain part of the source geometry. DXF uses declared
header units by default; a unitless drawing requires a selected override. Coordinates are preserved
without centering or an automatic Y flip. The preview uses the ordinary sketch axes with Y upward,
including unchanged SVG Y values.

Apply publishes one authored transaction containing any required V3 texture and V4 source upgrades, the immutable source
asset and one ordinary sketch. UUIDs for the sketch, entities, asset and ordered path outputs are
captured on Apply. Verified source bytes and semantic changes are published together through the
existing revision-safe source authority. The sketch has no imported feature or Part: open it with
Edit sketch, finish editing and use its ordinary closed profiles for Extrude or other profile tools.
Undo and Redo restore the whole transaction, and native Save/Open retains source bytes and captured
provenance.

Ordinary authored geometry determines later rebuilds. Coordinate edits preserve `sourceImport` and
its captured identities. Removing or replacing a captured curve or point identity explicitly detaches
the whole source binding; original bytes are never reparsed to overwrite edited geometry. Frozen
assembly body closures retain the source descriptors of their captured imported sketches. Historical
source bytes remain part of portable closure even after live geometry or provenance removal.

The bounded parser supports SVG paths, rectangles, lines, circles, ellipses, polylines and polygons,
including analytical arcs and exact quadratic-to-cubic conversion. DXF supports the analytical entity
and bounded block expansion subset documented in [ADR-0065](../adr/0065-bounded-exchange-geometry-import.md).
Text, raster images, external references, unsupported entities and geometry effects fail inspection;
there is no silent partial import. Non-planar, singular, degenerate or over-budget curves, and
disconnected segments within one path, also fail explicitly. The source is limited to 32 MiB,
captured outputs to 1024 paths and the ordinary native sketch capacity. A changed document requires
a new inspection. Rejected publication
retains the inspected source for retry; pending Apply prevents duplicate activation and closing.

Chromium acceptance covers SVG and DXF Apply, cancellation, Undo/Redo, reload, native Save/Open,
ordinary point editing with stable provenance, exact extrusion and STEP export. Worker and component tests separately
cover declared/selected units, bounded failure diagnostics, stale revisions, canceled late results,
duplicate activation, parser termination and publication retry.
