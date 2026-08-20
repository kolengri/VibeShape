# ADR-0025: First-class offset datum planes

- Status: Accepted
- Date: 2026-08-20
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md) and [ADR-0024](0024-stable-planar-face-sketch-support.md)

## Context

Origin planes and planar feature faces cover the first sketch workflows, but robust parametric models need reusable reference geometry that is independent of a body's transient surface. A datum plane must follow its semantic support, participate in rebuild ordering, accept variable-driven signed offsets, remain selectable and independently visible, and support downstream sketches. It must not become a printable body or consume the body that supports it.

The geometry registry currently owns exact `Shape3D` values. Introducing a second native ownership hierarchy only for a visual plane would expand the worker, cache, export, and disposal boundaries before additional reference geometry needs justify it.

## Decision

The first reference-geometry module is `org.vibeshape.core.reference-geometry`. Its first feature type is an offset Datum Plane with classification `reference` and two support modes:

- XY, XZ, or YZ origin plane with no feature dependency;
- one stable planar-face `TopoRef` with exactly one matching evaluation dependency.

The authored offset is a signed length `Quantity`. It retains literals, display units, and `#variable` expressions in the document; resolved canonical millimeters enter feature-content identity and geometry evaluation.

The document worker resolves an exact right-handed frame from the origin plane or supported Box, Cylinder, Extrusion, or Datum Plane face, then translates it along its normal by the signed offset. Cycles, missing supports, unsupported faces, and dependency/reference mismatches fail closed.

The geometry worker represents the datum with an ultra-thin owned OCCT plate so the existing native shape registry, tessellation, topology capture, selection, cache, and disposal contracts remain unchanged. Both parallel plate faces receive the semantic role `datum.plane`; downstream support resolution uses the feature's exact semantic frame rather than plate thickness or transient face order.

The plate is an implementation detail, not a body:

- datum dependencies never participate in body ownership;
- terminal-body traversal excludes reference features;
- STEP, STL, and 3MF export exclude reference features even though the display adapter owns a valid thin solid;
- project thumbnails exclude datum meshes;
- the viewport renders datum meshes with a distinct translucent appearance and retains normal picking;
- model-tree visibility is independent presentation state and does not suppress the semantic feature.

Create and edit use the ordinary revisioned feature command path. The command uses a currently selected supported planar face when available; otherwise the task panel exposes an accessible origin-plane select. Offset input uses the shared variable-aware length primitive and TanStack Form adapter, including single-flight asynchronous submission. A debounced schema-valid draft rebuilds in an isolated worker session, reusing the generic feature-preview path so support or offset changes move the translucent plane before commit without changing the semantic revision or project thumbnail.

## Consequences

- Sketches can start on offset planes and rebuild when the plane or its support changes.
- A datum can be renamed, hidden, shown, edited, deleted when unused, and selected directly in the 3D viewport.
- A supporting body remains independently visible, colored, terminal, and exportable.
- Native display ownership stays simple while semantic body/export ownership remains correct.
- Mid-plane, line-at-angle, three-point, tangent, axis, and point reference modes remain separate schema additions after edge and vertex selection is stable.
- If future reference entities cannot be represented safely by bounded display shapes, the geometry registry may gain a typed reference-display channel through a later ADR.

## Rejected alternatives

- **Store a world transform only:** the datum would stop following its support feature.
- **Use a transient Three.js plane without worker geometry:** selection, exact-revision rebuild, topology identity, and downstream support would split across authorities.
- **Treat the plate as a body:** it would appear in exports, consume support bodies, and corrupt multi-body semantics.
- **Add every datum construction mode now:** edge and vertex multi-selection, stable reference repair, and mode-specific UX are not yet production-ready.
