# ADR-0028: Selector-backed origin-axis revolve

- Status: Accepted
- Date: 2026-08-28
- Extends: [ADR-0018](0018-deterministic-sketch-profile-extraction.md), [ADR-0019](0019-selector-backed-new-body-extrusion.md), [ADR-0024](0024-stable-planar-face-sketch-support.md), and [ADR-0026](0026-document-dependency-graph-and-interleaved-history.md)

## Context

Revolve is the next distinct solid-modeling family after Extrude. It must retain a selected sketch region across edits, replay, worker replacement, and profile-result reordering without persisting solved coordinates, renderer identities, OCCT handles, or transient loop indices.

Onshape supports regions, planar faces, several axis sources, full and bounded end conditions, two directions, and New/Add/Remove/Intersect operations. Implementing that complete surface at once would combine new axis identity, merge-scope, end-condition, topology-role, and repair contracts before the smallest exact operation is proven.

## Decision

Add first-party feature type `org.vibeshape.feature.part-design.revolve#1` to the trusted Part Design module.

Its persisted parameters are:

- one schema-version-0 `SketchProfileSelector`;
- axis intent `x` or `y`, referring to the selected sketch support frame;
- one positive bounded angle `Quantity` greater than zero and no greater than `2π`, retaining its authored literal or `#variable` expression;
- operation `new`.

The source sketch is a semantic document input. A face-supported source sketch contributes its existing support feature dependency and `TopoRef`; that dependency positions the profile but does not become body ownership. A new-body Revolve therefore has no body dependency and remains an independent terminal body.

During rebuild, the document worker reuses the deterministic sketch solve and profile materialization path accepted for Extrude. It resolves the support frame, converts the authored axis intent into one world-space origin and normalized direction, and sends the exact analytical outer loop, holes, frame, and resolved radians as bounded transient content. The geometry worker independently validates cardinality and support-reference agreement, builds an exact OCCT face, and calls `BRepPrimAPI_MakeRevol`. Successful evaluation must produce exactly one valid positive-volume solid.

The document snapshot schema does not change because feature records already carry generic, handler-validated parameters. Geometry protocol version 11 also remains unchanged: its feature-content envelope already accepts bounded canonical JSON, while the new first-party content is validated by a dedicated strict schema at preparation and evaluation boundaries.

Create and edit use the ordinary feature command, preview, persistence-first, undo, History, and rebuild paths. The first product slice offers the current selected sketch profile, local X/Y axes, and a variable-aware angle field.

The following remain separate gates:

- selected construction lines, model edges, cylindrical axes, and Mate connectors as persistent axes;
- planar model faces or open curves as revolve inputs;
- symmetric, two-direction, up-to-entity, surface, and thin end conditions;
- Add, Remove, Intersect, and multi-body merge scope;
- stable semantic output roles and sketch support on Revolve-produced faces;
- general self-intersection repair and profiles that cross the axis.

Unsupported or invalid geometry fails closed and does not replace the last valid derived result.

## Consequences

- Turned parts can be authored as ordinary variable-driven parametric features without introducing a second profile identity system.
- Axis intent follows origin, Datum Plane, and supported planar-face frames after upstream edits.
- Full and partial revolutions share one exact kernel path and one canonical feature identity.
- The bounded first slice deliberately does not imply arbitrary-axis or modifying-operation compatibility.
- A later axis-selection ADR can add stable axis references without rewriting schema version 1 intent.

## Rejected alternatives

- **Persist a world-space axis only:** a supported sketch would stop following its parametric support frame.
- **Persist a construction-line index or mesh edge ID:** both are transient and can silently retarget after edits.
- **Encode Revolve as Extrude parameters:** this would corrupt feature terminology, validation, hashing, diagnostics, and automation.
- **Infer an axis from the nearest sketch line:** geometric proximity is ambiguous and is not replayable design intent.
- **Ship the complete Onshape surface immediately:** merge scope, general axes, end conditions, surfaces, and topology repair require independent durable contracts.
