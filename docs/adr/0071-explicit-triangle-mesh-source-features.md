# ADR 0069: Explicit triangle-mesh source features

Status: Accepted

## Decision

STL and 3MF imports create first-party mesh features with captured output UUIDs and immutable V4
source assets. STEP and BREP imports remain exact-solid features under ADR 0065. Meshes never acquire
invented BREP faces, edges, solids or volume. Their explicit representation marker, complete output
catalog, triangles, surface area and bounds distinguish them throughout rebuild, Part selection,
export, print preparation and frozen assemblies.

STL requires selected source units. 3MF uses its declared units and composes component transforms,
including reflection winding, once. Inspection keys locate an immutable parser result; authored
identity uses captured UUIDs, the verified source digest and parser policy. Source bytes are checked
on every rebuild, including native cache reuse and disposable previews.

Mesh bodies are independently selectable and exportable as STL or 3MF. STEP and exact modifying
operations reject them with an actionable diagnostic. Mesh Placement remains disabled until a
representation-preserving CPU implementation exists; assembly poses and disposable print copies
already transform their triangle geometry. This preserves the exact single-positive-solid gates.

## Format and authority boundaries

The parser rejects unsupported, unsafe and over-budget structures. 3MF model resources must satisfy
the existing closed, oriented, positive-volume manifold contract. STL may contain open triangles;
inspection reports its limitations, and strict 3MF export can reject an unsuitable STL mesh.
No importer silently fills holes or changes scale.

Source publication, imported feature commands and Part fan-out commit atomically. Undo restores the
whole transaction; historical source bytes remain available for redo and portable V4 archives.
Ordinary edited DXF/SVG curves instead use optional sketch provenance and the existing sketch
solver. Destructive captured topology edits detach that provenance; coordinate edits retain it.

## Acceptance

The native STEP import corpus, parser conformance tests, mesh worker/session tests, and production
browser workflows cover canceled inspection, explicit units, atomic Apply, Undo/Redo, reload,
portable Save/Open, selected export and representation-specific controls. Physical printability
and automatic mesh-to-solid conversion are separate capabilities.
