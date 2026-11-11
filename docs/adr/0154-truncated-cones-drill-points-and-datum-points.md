# ADR-0154: Truncated cones, drill-point holes and datum points

- Status: Accepted
- Date: 2026-11-11

## Context

Three bounded modeling gaps remained open. Cone produced only a pointed cone. Blind holes ended in
a flat bottom although twist-drilled holes have a conical point. Reference geometry offered Datum
Planes and datum axes derived from them, but no reference point. Each change must keep saved
documents replaying exactly, keep transient OCCT topology out of persistence, and stay available
to the same command, preview and MCP paths as the existing features.

## Decision

### Cone version 2

Cone v2 adds a required expression-capable `topRadius`. It accepts 0 (pointed apex) or a bounded
radial length of at least 0.001 mm that differs from the base `radius`; a larger value inverts the
taper. The workspace check uses the larger radius. The worker keeps the v1 three-edge meridian for
a zero top radius and revolves an exact trapezoid otherwise, naming both caps and rims
(`primitive.cone.{cap,edge}.{start,end}`) and the apex only for a pointed cone.

`authoredConeFeatureType` owns the version route: a missing top radius or a literal zero (no
variable) authors v1, any other value authors v2, and a saved v2 cone never migrates back. The task
panel and MCP `update_cone` both pass the saved type; MCP reads it from the owned draft, so an
omitted or literal-zero top radius on a saved v2 cone writes `topRadius: 0` on v2. Saved v1
records keep their exact schema and content hash. Equal radii are rejected; Cylinder owns that
shape.

### Hole version 4

Hole v4 extends v3 with an expression-capable included `tipAngle` on blind holes only, bounded to
60–180 degrees. 118 degrees is the authoring default for the opt-in task-panel control, and 180
degrees is a flat bottom.

`depth` keeps its existing meaning: the full-diameter cylindrical depth from the sketch plane to
the shoulder. The conical point is added beyond the shoulder, with height
`diameter / 2 / tan(tipAngle / 2)`. This matches the convention of common CAD hole tools and keeps
the depth of an existing hole unchanged when a point is added. Counterbore and countersink keep the
v3 geometry and validation. The worker revolves one exact cylinder-plus-cone meridian per center;
a flat point keeps the v3 cylindrical cutter. Through-all v4 holes carry no tip angle, so editing a
saved v4 hole to through-all does not change its schema version.

`authoredHoleFeatureType(savedType, parameters)` is the single Hole version owner for the form and
MCP. In priority order: a tip angle authors v4, a saved v4 stays v4, a recess treatment authors v3,
a saved v3 stays v3, an exact `targetBody` authors v2, and anything else is legacy v1. The task
panel passes its edited record's type; clearing its drill-point control on a saved v4 hole writes
180 degrees. MCP `update_hole` reads the saved type from the owned draft and passes it unless the
update omits `targetBody`, which remains the explicit request for legacy whole-result scope.
Omitted recess intent then defaults to a simple hole, and an omitted blind tip angle on a v4 hole
is a flat 180-degree point.

### Datum Point version 1

`org.vibeshape.feature.reference-geometry.datum-point` is a `reference` feature with three modes:

- `coordinates`: three bounded, expression-capable length quantities in model millimeters, with no
  dependencies;
- `vertex`: a body-bound vertex reference (`BodyVertexRef`, schema version 1, POINT signature);
- `circle-center`: a body-bound CIRCLE edge reference; the point is the analytical circle or arc
  center.

Reference modes depend on exactly the producer of the reference, and the generic `references`
array stays empty, matching reference-frame features. Only the semantic reference persists. The
application layer resolves it against the current exact body topology on every rebuild. A missing
or ambiguous reference fails the feature with
`org.vibeshape.feature.datum-point-reference-unresolved` and a `missing`, `ambiguous` or
`not-circular` reason; it never rebinds silently. A semantic role (for example a box corner) keeps
following the same intent when its producer is resized or moved.

The worker renders a 4 mm marker sphere, semantically named `datum.point`. Like Datum Planes, it is
display geometry: `isReferenceGeometryFeature` excludes every reference feature from bodies,
measurements, topology inspection, terminal-body export and thumbnails. The task panel offers only
references that resolve back to the same candidate today; a saved reference that no longer
resolves stays visible and blocks save until the user picks a replacement.

## Consequences

- Cone v2, Hole v4 and Datum Point v1 are new registered types; older applications reject them as
  unavailable types instead of misreading them.
- MCP `create_cone`/`update_cone` gain optional `topRadius`, `create_hole`/`update_hole` gain
  optional `tipAngle`, and `create_datum_point`/`update_datum_point` follow the Datum Plane tool
  pattern on local and remote adapters.
- Body topology inspection still lists only edges and faces, so MCP agents obtain circle-edge
  references from `model_body_topology`; vertex references come from the editor or an existing
  feature until inspection exposes vertices.
- Datum points are not yet accepted as explicit centers or origins by Pattern, Placement or other
  consumers. Those consumers persist their own axis/plane schemas, so accepting a point needs a
  versioned consumer change and is a follow-up.
- Horn and spindle tori remain out of scope.
