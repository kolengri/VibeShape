# ADR-0024: Stable planar-face sketch support

- Status: Accepted
- Date: 2026-08-20
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md), [ADR-0019](0019-selector-backed-new-body-extrusion.md), and [ADR-0023](0023-explicit-target-extrusion-operations.md)

## Context

Origin planes are sufficient for the first sketch-driven solid, but ordinary parametric modeling must also start a sketch on a planar face produced by an earlier feature. A rendered triangle ID, Three.js face index, OCCT face order, or evaluation-local candidate ID is not persistent topology. Saving any of those values would silently retarget or break the sketch after a parameter change.

A supported sketch also creates two different relationships. The producing feature is an evaluation dependency because changing it can move the support frame. It is not necessarily a body target: a new-body extrusion attached to a Box face must leave both the Box and the new extrusion as independent terminal bodies.

## Decision

Sketch schema version 0 gains an optional `feature-face` support containing one planar face `TopoRef`. The existing XY, XZ, or YZ value remains the deterministic origin-plane fallback and the sketch-local orientation choice; no tessellation identity enters the document.

The product maps a selected rendered face to stable support as follows:

1. Three.js returns the worker-provided tessellation face ID for the selected triangle.
2. The current feature geometry joins that ID to a topology candidate through its evaluation-local `meshFaceId`.
3. Only a planar candidate with a supported semantic role is promoted to a persistent `TopoRef`.
4. The document stores the producing feature ID, semantic role, optional lineage, geometry signature, and selection intent. It never stores `meshFaceId`, `candidateId`, or an OCCT index.

The initial analytical support resolver accepts planar Box faces, Cylinder start/end caps, and Extrusion start/end caps. It resolves an exact right-handed world frame from semantic feature parameters and recursively resolved source-sketch frames. Missing, cyclic, non-planar, ambiguous, or unsupported references fail closed. General planar B-Rep resolution and repair remain later work.

Document and geometry protocol version 9 carry the optional sketch support and an explicit extrusion frame. Canonical feature content encodes the `TopoRef` against its ordered dependency `inputIndex`. The geometry worker independently verifies that the reference and `supportFeatureId` select the same dependency before constructing the exact OCCT prism in that frame.

An extrusion attached to a feature face declares the support owner as a feature dependency and stores the matching `TopoRef`:

- `new` has no body dependency, even when it has one support dependency;
- `add`, `remove`, and `intersect` keep the explicit target as the first body dependency and may additionally depend on one distinct support owner;
- terminal-body and export traversal use body dependencies, not every evaluation dependency;
- removing a feature that supports any sketch is blocked before event creation and during replay validation.

Origin planes remain visible, independently toggleable display datums. Feature visibility is independent presentation state: hiding a feature removes its committed mesh and clears an invalid selection without suppressing or mutating the semantic feature.

## Consequences

- A user can select a supported model face and enter the sketch editor directly.
- Editing the producing feature invalidates and rebuilds the dependent sketch extrusion through the ordinary DAG and content hash.
- New bodies created from another body's face remain separately colored, visible, exportable terminal bodies.
- Deletion cannot leave a dangling sketch support.
- Protocol version 9 is intentionally incompatible with version 8 clients that do not understand support references or arbitrary extrusion frames.
- Offset, angular, and user-created datum planes need a separate semantic datum-feature contract; they must not be simulated with hidden meshes or transient transforms.

## Rejected alternatives

- **Persist a render face ID:** tessellation identity is evaluation-local and changes after remeshing.
- **Persist an OCCT face index:** topology ordering is not stable across rebuilds.
- **Infer the support from feature-tree position:** tree order does not identify a face or preserve user intent.
- **Treat every dependency as body ownership:** a support-only dependency would incorrectly hide or consume the producing terminal body.
- **Store only a world transform:** the sketch would stop following its parametric support feature.
- **Accept every visually planar face immediately:** unsupported topology without a stable resolver can silently retarget and is less safe than a typed rejection.
