# ADR-0002: Geometry Worker Boundary

- Status: **Accepted**
- Date: 2026-08-07

## Decision

Run OCCT, the solver, rebuilds, tessellation, and CAD import and export outside the main thread. The boundary is a versioned structured-clone protocol, and large buffers are transferred rather than copied.

## Consequences

- Synchronous kernel calls do not block the UI.
- Kernel handles cannot leak into React or Three.js.
- The worker can restart from a committed snapshot.
- Cancellation is often logical cancellation rather than interruption of the active C++ call.
- The protocol and its diagnostics require explicit versioning and testing.
