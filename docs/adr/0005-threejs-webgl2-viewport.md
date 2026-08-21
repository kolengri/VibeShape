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

The first production adapter now lives in `@vibeshape/viewer`. It binds transferred position, normal, index, and triangle-face identity arrays to Three.js `BufferGeometry`, displays only authoritative terminal feature geometry from the document rebuild response, uses an orthographic Z-up camera with OrbitControls and on-demand rendering, and owns all renderer, control, geometry, edge-geometry, and material disposal. The three origin planes remain visible as individually toggleable display datums unless the user hides them; they are pickable only while selecting a sketch support, so they do not block solid selection. Terminal bodies receive a stable display-only palette derived from their feature identity. It never changes the semantic operation, material, or persistent model data. React owns only the canvas host, localized states, selection summary, and explicit controls.

The initial subshape-selection slice uses a CPU `Raycaster` against the indexed surface meshes. Three.js `faceIndex` identifies the intersected render triangle, and the worker-provided `triangleFaceIds` array maps that triangle to the rendered OCCT face. Hover preselection and committed selection extract only matching triangles into disposable overlay geometry. Primary click selects or clears, middle drag rotates, and secondary drag pans.

The adapter also exposes a framework-neutral support-frame camera port. `orientToFrame` validates a finite,
normalized, orthogonal, right-handed frame and reorients the existing orthographic camera without changing
its distance or view height. `setInteractionMode` separates ordinary selection from camera-only navigation.
Camera-only mode preserves OrbitControls but clears transient highlights and suppresses raycast selection,
preselection, and selection callbacks. React may use this mode while a sketch draft is inspected in 3D;
the analytical draft remains semantic authority, and its world-space line display is disposable derived
geometry.

These face IDs are **ephemeral view metadata** for the current rebuild. Mesh replacement clears selection, and neither the ID nor its friendly ordinal may be persisted, used in domain commands, or treated as `TopoRef`. Stable downstream references must continue through the accepted topology-resolution contracts. Body, edge, vertex, and stable-reference selection, view presets, clipping, and display modes remain later adapter capabilities.
