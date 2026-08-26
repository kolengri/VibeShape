# External Sketch References Plan

- Status: **In progress**
- Reviewed: **2026-08-25**
- Scope: same-document, same-model external references for the sketch-first workflow

This is the detailed external-reference slice of the broader
[Associative Sketch and Feature Workflow Plan](associative-sketch-and-feature-workflow-plan.md).

## Problem

A sketch currently owns only its authored entities, constraints, dimensions, and support frame. It can be
placed on an origin plane, a datum plane, or a supported planar feature face, but it cannot retain an
associative relationship to geometry from an earlier sketch or feature. Users therefore cannot drive one
sketch from a layout sketch, a prior profile, or a model edge without manually re-entering dimensions.

This is a P0 parametric-modeling gap. External geometry must be a durable relation, not copied drawing
geometry or an untracked viewport snap.

## Onshape behavior used as reference

Onshape distinguishes three related behaviors inside a Part Studio:

| User action | Result | Association behavior | VibeShape interpretation |
| --- | --- | --- | --- |
| Hover or place on a coplanar earlier sketch/feature vertex or edge | An inferred external constraint | The constraint remains tied to the outside entity; Onshape displays it as an external relation | `inferred` external constraint between an authored entity and a stable source selector |
| **Use** (`U`) on an edge or sketch entity | A projected/conversion reference on the active sketch plane | The used edge updates with source geometry; source geometry-type changes can break the relation | Read-only projected external geometry plus an explicit source selector |
| **Intersection** on a face or surface | The intersection curve on the active sketch plane | The resulting geometry updates and is constrained to the source face/surface | Read-only intersection reference plus explicit source selector |

The source behavior is documented by Onshape's [Sketch Basics](https://cad.onshape.com/help/Content/sketch_basics.htm), [Working with Constraints](https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm), [Use](https://cad.onshape.com/help/Content/Sketch/use.htm), and [Intersection](https://cad.onshape.com/help/Content/Sketch/intersection.htm) help pages. In particular, Onshape identifies relations to geometry outside the current sketch separately from internal constraints and limits `Use` to trackable geometry. VibeShape must use those principles, not copy transient tessellation or OCCT edge indices.

Onshape also offers **Derived** for an associative one-way link to sketches, parts, planes, and curves in a
different Part Studio or document. That is a separate cross-document/master-model capability and is not
part of this first slice. See [Derived](https://cad.onshape.com/help/Content/PartStudio/derived.htm).

## Product contract

### Implemented point-and-line foundation

The delivered foundation lets a dependent sketch retain a **projected point or line reference** to an
earlier saved sketch or a stable model vertex or linear feature edge. A point can attach one authored point
with a Coincident relation. A projected line is read-only construction geometry whose fixed projected endpoints can drive Point on line, Parallel,
Perpendicular, Equal, Angle, and other compatible solver relations without becoming a profile boundary. A
sketch references persist only stable source and projected entity IDs. Model references persist a versioned
`TopoRef` plus projected entity IDs; they never persist candidate IDs, mesh ordinals, native hashes, or
coordinates. The document worker resolves current source coordinates before every solve, transforms them
through world space into the target support, and rejects a line whose projection degenerates to a point.

The icon-only **Use external geometry** tool exposes compatible source points and lines on the
normal-to-sketch drawing and in the persistent 3D viewport. Orbit mode provides graphical hover
preselection, a source label, and direct selection without recreating the camera. The task panel identifies
and removes references; removal also removes constraints that target the projected geometry. Deleting a
referenced source sketch is rejected.

Sketch-to-sketch Use supports analytical circles, arcs, and ellipses plus ordered reference chains. The
worker boundary publishes exact vertex positions, linear endpoints, and analytical circle or bounded-arc
frames for generic topology candidates. Analytical Box boundaries, Cylinder rim roles, and prepared source
point/entity IDs give supported candidates stable roles across parameter edits; distinct coincident source
points remain unlabeled so resolution fails closed instead of choosing one by traversal order. Authoritative
sketch solving resolves model references fail-closed. Normal and orbit views provide the same graphical
preselection and creation path for vertices, linear edges, circles, and circular arcs without persisting
display samples. Circular display samples are cached per rebuild and support frame, while draft changes only
re-evaluate stable-reference availability. The first Intersection slice selects one visible planar model
face in the persistent 3D viewport and asks OCCT for exactly one bounded linear section against the active
sketch plane. It persists only the face `TopoRef` and projected line identities; the current face hash stays
worker-local. Parallel, coplanar, disjoint, ambiguous, multi-edge, nonlinear, and zero-length results fail
closed. Point and Line placement now wake visible earlier-sketch points and lines, highlight and label the source, and atomically create the stable reference plus inferred constraint only after acceptance. General surfaces, multi-curve results, Pierce, curve and model-topology wake-up, non-circular curved
model edges, 3D overlap disambiguation, grave-accent cycling, and repair UI are not implemented. Normal-view Use provides a bounded labeled chooser when candidates overlap. Persisted coordinates remain disposable: both UI preview and
authoritative worker evaluation derive them from stable source identity and resolved support frames.

### Reference types

The first release supports only source geometry that can be selected and resolved deterministically:

1. A point, line, circle, arc, ellipse, or elliptical arc from an earlier saved sketch.
2. A stable planar feature-face edge selected through an existing `TopoRef` resolution path.
3. A stable planar feature face for `Intersection` only after a bounded analytical intersection can be
   represented exactly.

The product exposes three explicit tools in the active sketch:

- **Use external geometry**: select one source sketch entity or feature edge and project it to the active
  sketch frame.
- **Intersect geometry**: select one supported feature face or surface and create its intersection with
  the active sketch plane.
- **External inference**: while placing or dragging authored geometry, show an external candidate and
  create a supported external relation only after an explicit accepted inference.

All references are visible by default as a distinct construction/reference presentation. They are never
profile boundaries, cannot be directly edited, and have a dedicated visibility toggle. Hover, selection,
and the constraint manager identify their source sketch or feature, source label, mode, and resolution
state. The UI must provide an accessible list and removal action; a canvas gesture is not the only way to
inspect or remove an external reference.

### Failure and repair

External references must fail closed. They never silently bind to a different entity after an edit,
topology change, deletion, suppression, missing extension, or missing derived result.

- A changed source sketch entity ID, missing source sketch, incompatible projection, or unsupported
  geometry type produces a source-owned `missing` diagnostic.
- A feature-edge source resolves through its semantic role and signature. An ambiguous `TopoRef` produces
  an `ambiguous` diagnostic and a bounded repair flow; it does not choose the nearest edge.
- The last valid reference display may remain as clearly stale diagnostic context, but it is not fed to
  the solver or a downstream feature evaluation.
- Deleting a sketch or feature with incoming external references is blocked with visible dependents, just
  as deleting an extrusion-owned sketch is blocked today.

## Data and evaluation design

The authoritative owner is the existing first-party **sketching capability**. This extends its schema,
commands, solver preparation, and editor UI; it does not create a package, extension API, or MCP tool.

```text
Saved source sketch or feature
  └─ stable sketch entity ID or TopoRef selector
       └─ ExternalSketchReference in dependent SketchRecord
            ├─ resolved read-only 2D reference geometry for SolveSpace
            ├─ external relation constraints to authored sketch entities
            └─ visible diagnostic and dependency edge
```

`packages/domain` owns the versioned `ExternalSketchReference` schema, source selectors, semantic
dependency validation, deletion protection, and stable failure diagnostics. A reference record contains:

```text
id
mode: inferred | use | intersection
source:
  sketch-entity: sourceSketchId + sourceEntityId
  feature-topology: sourceFeatureId + TopoRef
projection: exact support-frame policy and schema version
visibility
```

The record stores identity and intent, not solved points, SVG paths, OCCT handles, raw edge indices, or a
copy of source geometry. The document worker resolves source geometry in evaluation order, transforms it
to the dependent sketch frame, creates bounded read-only solver input, and returns disposable display
geometry. The viewer and React editor receive only serializable display data and stable IDs.

The existing feature-only DAG is not sufficient by itself. This slice must introduce a validated document
dependency graph that includes sketches as dependency owners. It must reject forward references and every
cycle across sketch → sketch, sketch → feature, and feature → sketch relationships. Source changes mark
all downstream sketches and their dependent features dirty. Presentation order remains user-readable but
cannot alter evaluation order.

## Delivery order

1. **Schema and graph groundwork**: add explicit sketch dependency edges, versioned external-reference
   records, migration/default behavior, cycle detection, deletion protection, and replay tests.
2. **Coplanar sketch-to-sketch Use**: support point/line/circle/arc references between saved sketches on
   equivalent frames. Resolve exact source geometry, show it read-only, and allow Coincident,
   Horizontal/Vertical, Parallel, Perpendicular, Concentric, Tangent, and dimensional relations where
   solver semantics permit them.
3. **Editor interaction**: the icon-only `Use external geometry` tool, point/line external inference,
   visible preselection, source labels, a reference list, visibility toggle, and accessible removal are implemented. Extend automatic inference to curves and stable model topology.
4. **Feature-edge Use**: exact vertex, linear-edge, circle-edge, and arc-edge payloads, stable
   model-reference schemas, progressive rebuild, fail-closed worker resolution, and graphical normal/orbit
   candidate selection plus a normal-view overlap chooser are implemented. Add non-circular curved edges, 3D overlap disambiguation, grave-accent cycling, source filters, and
   repair diagnostics.
5. **Intersection**: one planar face to one bounded linear section is implemented with graphical 3D
   selection and exact OCCT evaluation. Add analytical curved and multi-segment face/surface results plus
   explicit `Pierce` relations without approximating them from the display mesh.
6. **Derived/master-model links**: address separate Part Studios, external documents, version/workspace
   locking, update policy, and permissions as a later architectural slice.

## Acceptance criteria for the first vertical slice

- A user can create Layout Sketch, then create Detail Sketch on the same plane and Use one Layout Sketch
  line or point.
- Changing the Layout Sketch moves the Detail Sketch's external reference and causes its dependent
  extrusion to rebuild without rewriting the dependent sketch's authored constraint sources.
- The used reference cannot form an extrusion profile by itself and cannot be edited as local geometry.
- Removing the source sketch is blocked while Detail Sketch depends on it.
- A missing, deleted, suppressed, incompatible, or ambiguous source yields a localized diagnostic and no
  guessed geometry.
- Save/reload, `.vshape` round-trip, worker restart, and deterministic replay preserve the reference
  identity and rebuild behavior.
- Component and Playwright tests cover pointer and keyboard tool paths, source preselection, visibility,
  removal, invalid/ambiguous references, and a real worker rebuild.

## Explicit non-goals

- Cross-document or cross-Part-Studio Derived links.
- Assembly in-context references and context snapshots.
- Arbitrary NURBS/spline projection or mesh-derived reference geometry.
- Automatic repair that rewrites a reference selector.
- A public extension or MCP mutation surface before this first-party command path is stable.
