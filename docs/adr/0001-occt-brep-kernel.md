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

## Spike Evidence

[SPK-001](../spikes/spk-001-occt-worker.md) proves the required Replicad modeling, tessellation, STEP round-trip, and STL operations in Chromium, Firefox, and WebKit. Its current result is **Rework** because the published WASM does not disclose the exact embedded OCCT source revision and extended Chromium runs show unexplained linear-memory growth. This ADR therefore remains accepted only for the spike; it does not select the production binding.

## Rejected Alternatives

- Three.js geometry or CSG as the primary kernel
- A Manifold- or OpenSCAD-style mesh kernel as the only source of truth
- A server-only proprietary kernel, because it conflicts with the local and offline goals
