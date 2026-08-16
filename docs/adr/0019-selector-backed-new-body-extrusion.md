# ADR-0019: Selector-backed new-body extrusion

- Status: Accepted
- Date: 2026-08-09
- Extended by: [ADR-0023](0023-explicit-target-extrusion-operations.md)

## Context

The first sketch-driven solid must preserve modeling intent across variable edits, replay, worker replacement, and profile-result reordering. A persisted profile index, solved coordinate array, OCCT wire, face number, or native handle would bind the semantic document to disposable derived state and could silently extrude the wrong region after a sketch changes.

The document worker also needs enough exact analytical geometry to construct an OCCT face without moving SolveSpace or sketch topology ownership into the geometry worker. The boundary must remain strict, bounded, serializable, and independently validated.

## Decision

Add first-party extrusion feature type `org.vibeshape.feature.part-design.extrusion#1`. Its persisted parameters are:

- one schema-version-0 `SketchProfileSelector` containing the stable sketch ID and canonical boundary entity-ID sets;
- one positive bounded length `Quantity` for distance, retaining its authored literal or `#variable` expression;
- a symmetric flag;
- operation `new`.

The feature has no feature-DAG dependency because the selected sketch is semantic source input rather than derived B-Rep geometry. Removing a referenced sketch is rejected. New-body extrusion is the only accepted operation in this increment; add, remove, and intersect require explicit body ownership and dependency semantics before they can be persisted.

During each document rebuild, the document worker:

1. resolves extrusion distance against the committed variable table;
2. solves each referenced sketch at most once for that rebuild;
3. resolves the stable selector against the latest deterministic profile result;
4. fails closed when the sketch, solve, loop, or selector is missing, invalid, or ambiguous;
5. materializes the selected analytical line, arc, and circle loops from stable solved entity IDs;
6. sends only strict, bounded transient profile content to geometry protocol version 8.

The geometry worker maps the sketch plane to world coordinates, builds exact OCCT edges, wires, and a face, and creates a prism. A symmetric extrusion starts at `-distance / 2`; a non-symmetric extrusion starts on the sketch plane. Temporary edges, wires, faces, vectors, and builders have lexical ownership and deterministic disposal. Successful faces publish `extrusion.cap.start`, `extrusion.cap.end`, and stable `extrusion.side.<SketchEntityId>` semantic roles where the mapping is unique.

Prepared analytical content participates in canonical feature hashing. Because its source is recomputed from semantic sketch state, an extrusion is considered for preparation on every rebuild; an identical prepared content hash reuses the prior successful B-Rep and mesh without invoking OCCT again. Solved coordinates and transient profile indices never enter the document, event history, or `.vshape` archive.

The initial product flow creates extrusion only from the sole profile of a VibeShape rectangle sketch. Its state-agnostic parameter panel is wrapped by a TanStack Form adapter, retains raw invalid input, accepts literal or committed `#variable` distance expressions, guards asynchronous double submission, and supports create and edit. Commit remains persistence-first under ADR-0016. Interactive unsaved solid preview and arbitrary profile picking remain follow-up work.

## Consequences

- Editing a document variable or sketch dimension deterministically rebuilds every affected extrusion while preserving the authored expression and feature identity.
- Worker restart and profile-array reordering do not change the selected region.
- A changed or ambiguous boundary blocks the extrusion instead of substituting a similar loop.
- Exact profile geometry crosses only the document-worker-to-geometry-worker boundary and remains disposable.
- Sketch deletion now has reference integrity even though sketches are not feature-DAG nodes.
- The first extrusion produces a separate terminal solid and does not yet modify an existing body.

## Rejected alternatives

- **Persist profile or loop indices:** unrelated topology ordering changes can retarget the feature silently.
- **Persist solved coordinates or an OCCT wire:** derived state would become part of the native document and invalidate deterministic recovery.
- **Make the geometry worker solve sketches:** combines independent native runtimes, expands its protocol authority, and duplicates document-worker state.
- **Represent the sketch as a feature dependency:** feature dependencies carry derived B-Rep content hashes, while a sketch is semantic analytical input without solid geometry.
- **Implement add, remove, and intersect immediately:** body ownership and target selection need their own durable contracts rather than implicit tree order.
