# ADR-0005: Raw Three.js with a WebGL2 Baseline

- Status: **Accepted**
- Date: 2026-08-07

## Decision

Use a raw Three.js adapter on the main thread with WebGL2 as the baseline. React owns the UI shell but does not own the lifetime of the CAD scene graph.

## Consequences

- Picking, subshape mapping, and disposal are explicit.
- The viewport API is tested independently.
- WebGPU and OffscreenCanvas may be introduced after profiling.
- The renderer does not participate in exact geometry and never exports display-level meshes as print meshes.

The first production adapter now lives in `@vibeshape/viewer`. It binds transferred position, normal, index, and triangle-face identity arrays to Three.js `BufferGeometry`, displays only authoritative terminal feature geometry from the document rebuild response, uses an orthographic Z-up camera with OrbitControls and on-demand rendering, and owns all renderer, control, geometry, edge-geometry, and material disposal. React owns only the canvas host and localized states. Picking, selection, view presets, clipping, and display modes remain later adapter capabilities.
