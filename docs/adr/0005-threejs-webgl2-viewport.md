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
