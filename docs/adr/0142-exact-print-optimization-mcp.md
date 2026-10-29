# ADR-0142: Exact Automatic Print Optimization through MCP

- Status: Accepted
- Date: 2026-10-29
- Extends: [ADR-0141](0141-exact-preserved-print-interfaces.md)
- Supersedes: ADR-0141's paired-MCP exclusion for the automatic print workflow only

## Decision

Expose `analyze_print_optimization` and `request_print_optimization` on both paired transports.
They reuse browser-owned numerical jobs and source-bound proposal coordination. Inputs reference
one current exact Part by saved revision, producer/output and content hash. Bed and preservation
faces use existing body-scoped geometric references from `model_body_topology`; only the active
browser resolves them to disposable native tessellation bindings. Exact signatures, unique resolution
and native bindings must agree. No mesh, lattice, native handle or STEP payload becomes tool input.

The browser shares editor setup defaults and the existing automatic scenario generator. Both
analysis and request compute the same exact reconstruction, original-boundary FEM verification and
STEP reinspection as editor Apply. Results expose bounded proposal metrics, resolved configuration,
print frame and exact-body evidence. Transport validation binds requested options, material, four
scenario names, SIMP/FDM settings and exact retained performance against the original baseline.

Requests pass the private prepared STEP to ordinary import review and revision-checked persistence.
One transaction creates a separate exact Part, hides the editable source and retains normal Undo.
External-client review and connected-assistant authority remain unchanged. Cancellation, actor/session
ownership, single-flight work and source invalidation reuse existing coordinators. Native Boolean
work already executing remains synchronous; cancellation prevents stale publication.

## Consequences

Agents can discover faces, choose plastic or custom properties, configure and run the complete exact
automatic workflow without manipulating UI controls. Existing manual structural and Quick tools keep
their contracts. No document or worker protocol migration is needed, and no solver/native algorithm
is duplicated. Omitted geometry-derived defaults are resolved in the browser and reported explicitly.
Hypothetical loads, isotropic response and manufacturing approximations remain explicit limitations.
See the [operator workflow](../../.agents/skills/vibeshape-modeling/references/print-optimization.md).
