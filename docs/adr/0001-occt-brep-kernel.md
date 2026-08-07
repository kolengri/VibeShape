# ADR-0001: OCCT WASM as the Geometry Kernel

- Status: **Accepted for spike**
- Date: 2026-08-07

## Context

The application needs exact booleans, fillets, chamfers, B-Rep, STEP exchange, and browser-based tessellation. Mesh CSG does not preserve analytic surfaces and is not a sufficient foundation for mechanical parametric CAD.

## Decision

Use Open CASCADE Technology through WebAssembly. Start with Replicad and a custom OpenCascade.js build behind the `GeometryEngine` interface. The domain layer must not depend on Replicad or OCCT APIs.

## Consequences

- High-quality exact CAD and data exchange become possible.
- The WASM payload, object lifetime management, and LGPL compliance are significant costs.
- Custom bindings are likely to be required.
- Phase 0 must verify history and topology APIs, size, startup time, memory behavior, and format support.

## Rejected Alternatives

- Three.js geometry or CSG as the primary kernel
- A Manifold- or OpenSCAD-style mesh kernel as the only source of truth
- A server-only proprietary kernel, because it conflicts with the local and offline goals
