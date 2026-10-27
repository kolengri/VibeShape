# ADR-0065: Bounded exchange geometry import

- Status: Accepted parser boundary; product integration remains staged
- Date: 2026-10-03
- Local geometry/resource admission policy partially superseded by [ADR-0134](0134-local-geometry-resource-policy.md)
- Extends: [ADR-0004](0004-local-first-storage.md), [ADR-0060](0062-durable-source-assets-and-portable-closure.md)

## Context

STL and 3MF carry triangle meshes. DXF and SVG can carry analytical curves, text, raster references,
effects and other geometry that the sketch model cannot yet reproduce. A successful import must not
silently lose unsupported geometry or represent a tessellated curve as an authored CAD curve.
Untrusted files also require limits before native construction or durable publication.

## Decision

`@vibeshape/formats/import` exposes `parseGeometryImport(unknown)`, returning a strict inspection result
or a typed diagnostic. It copies source bytes and performs no network, DOM, persistence or native
kernel work. Source digests, descriptor identities, captured output identities and atomic publication
belong to ADR-0060's import authority. Parser IDs describe one transient inspection only.

Mesh results contain normalized millimeter vertices, triangle indices and build nodes with affine,
column-major 4x4 transforms. Negative determinants are retained with explicit `reversesWinding`;
consumers must reverse triangle winding when baking a mirrored node. Mesh resources and placed
instances have separate budgets. A mesh with no positive-area triangles fails. Mixed zero-area faces
are retained with a counted warning, rather than silently repaired. Meshes remain meshes.

Curve results contain separate paths, closure, source labels/layers, an affine transform and exact
line, circular/conic arc, circle, ellipse, quadratic Bézier or cubic Bézier data. Affine placement
preserves conics under nonuniform scale or shear. Curves are never sampled into polylines. Coordinates,
control points and transformed geometry must remain finite within the millimeter bounds. No parser
centers geometry, changes its source orientation or invents durable topology identities.

Use the existing Three.js `STLLoader.parse` for ASCII and binary STL after strict facet/count/finite
preflight. STL requires selected length units. Use the existing bounded ZIP reader and worker-safe
`saxes` 6.0.0 for 3MF Core XML. 3MF follows its declared units, or the Core default of millimeters,
and preserves nested components/build transforms. All resource references and cycles are checked,
including unused resources. Unknown geometry resources, extension relationships and unsupported
required extensions fail. Metadata paths are explicitly allowed; XML metadata shares the same node
budget. External references are forbidden.

Use `dxf-parser` 1.1.2 for DXF syntax and entities. Its parser can skip unsupported entities, so a bounded
group inventory rejects them before calling it. The inventory also verifies complete numeric tokens,
classic POLYLINE termination, LWPOLYLINE declared counts and safe dictionary/block names. `$INSUNITS`
maps inches, feet, millimeters, centimeters, meters and microns; absent, unitless or other units require
an explicit override. Blocks preserve base points, array placement, scale, rotation and layer inheritance
with bounded expansion. Exact bulges become circular arcs. Binary DXF, fitted/spatial polylines,
non-default extrusion planes, thickness, wide polylines, text and splines fail explicitly in this version.
The sync-only distribution entry has a narrow local declaration because upstream's general declaration
imports Node streams; library/browser TypeScript environments remain separate.

Use zero-dependency `svgpath` 2.6.0 for full SVG path syntax and exact normalization; never call its
arc-to-Bézier approximation. Unitless coordinates use explicitly selected user units. Selecting `px`
uses 96 pixels per inch. Physical lengths are converted into these local user units before nested
viewport and affine transforms. Width/height/viewBox and preserveAspectRatio have an explicit mapping;
unresolved percentage lengths fail. Source numeric Y orientation is retained. Paths, basic shapes,
groups and nested SVG viewports are supported. Text, use/image/foreignObject, stylesheets, clipping,
masks, filters and CSS geometry effects require a later explicit policy and fail. Non-rendering defs
and metadata are omitted from geometry, but their complete trees still undergo URI/script checks.

The parser boundary defaults to 32 MiB source bytes, 64 MiB expanded ZIP bytes, 256 ZIP entries,
compression ratio 100, XML depth 64 and 100,000 XML nodes per import, 250,000 source/expanded vertices
and triangles, 10,000 analytical segments, 128 mesh objects/block instances and recursion depth 16.
Callers may lower these limits, never enlarge them. DTD/entity declarations, processing instructions,
external URIs, archive traversal, symlinks and suspicious compression ratios fail. There is no implicit
partial-import mode. Future partial approval must name the omitted geometry and capture that choice.

## Consequences and evidence

- Pins retain the existing TypeScript/Bun/browser stack: Three.js catalog 0.185.1, `saxes` 6.0.0,
  `dxf-parser` 1.1.2 and `svgpath` 2.6.0. The first parser is ISC; the other libraries are MIT.
  Preserve their license notices in release artifacts. Saxes' upstream repository is archived; the
  bounded wrapper and hostile-input corpus remain necessary maintenance boundaries.
- `svg-pathdata` was considered; its current Node 24.14 requirement adds no value over the selected
  browser-compatible exact normalizer. Three's 3MF loader was rejected because its ZIP/DOM path does
  not provide this worker resource boundary.
- Tests cover native-writer 3MF round trips, independent Three STL writer output, declared/selected
  units, exact path commands and endpoints, closure, physical lengths, transformed blocks/components,
  mirrored winding, malformed/truncated/nonfinite data, cycles, indices, unsupported geometry,
  archive attacks and reduced budgets. Existing format regressions remain required.
- A browser-target bundle and real Chromium module-worker calls for all four formats verify module
  compatibility; they do not prove product authoring, durable
  restart, sketch solver acceptance, viewer placement or slicer interoperability. Those remain owning
  integration gates. Parser completion does not complete the product import capability.

## References

- [Three.js STLLoader](https://threejs.org/docs/#STLLoader)
- [3MF Core specification](https://github.com/3MFConsortium/spec_core)
- [Saxes](https://github.com/lddubeau/saxes)
- [DXF parser](https://github.com/gdsestimating/dxf-parser)
- [SVG path normalizer](https://github.com/fontello/svgpath)
- [SVG arc conversion](https://www.w3.org/TR/SVG/implnote.html#ArcConversionEndpointToCenter)
