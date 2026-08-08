# ADR-0014: SolveSpace v3.2 subset behind a flat WASM solver ABI

- Status: Accepted
- Date: 2026-08-08

## Context

VibeShape requires a mature geometric constraint solver for point, line, circle, and arc sketches. SolveSpace provides the required GPL-compatible equations and status reporting, but its official browser application and high-level Embind API are experimental, stateful, and broader than the product boundary. Passing C++ pointers or long-lived native objects through application code would make lifecycle, validation, recovery, and worker restarts difficult to prove.

SPK-002 source-built the stable SolveSpace v3.2 solver at revision `27b6a080c8b669421bd4d444650c3b8eddec5687`, exercised all P0 constraint primitives, classified fully, under-, and over-constrained systems, returned a conflict set, ran 1,600 deterministic perturbation solves, and completed 1,000 create/solve/dispose cycles without further heap growth. The same ABI passed 19 fixtures in a Chromium module worker.

## Decision

Use the required SolveSpace v3.2 solver sources as a narrow, source-built WebAssembly module behind VibeShape's flat typed-array ABI.

- Solver execution stays in a worker.
- TypeScript validates every input and native result with Zod.
- The native wrapper independently rejects duplicate or zero handles, zero record groups, unsupported record types, and dangling structural references before calling SolveSpace.
- Inputs contain flat parameter, entity, and constraint records plus scalar values and dragged-parameter handles.
- Outputs contain copied solved values, degrees of freedom, normalized status, maximum residual, failed constraint handles, and heap capacity.
- No C++ pointer, SolveSpace singleton, or native container crosses the ABI.
- The VibeShape adapter maps native statuses to `fully-constrained`, `under-constrained`, `over-constrained`, or `failed` and never removes a conflicting constraint automatically.
- Source revisions, archives, hashes, patch, wrapper, toolchain image, build environment, evidence, licenses, and corresponding source remain reproducible and publishable together.
- Heavy source builds and evidence are local-only. They must not be added to pull-request, push, scheduled, or manually dispatched GitHub Actions without a separate CI-budget decision.
- Generated native outputs remain quarantined until the production sketch worker and release packaging consume an exact reviewed build.
- Production sketch records must enforce semantic compatibility between constraint and entity kinds; the flat ABI only guarantees structural validation and native containment.

## Consequences

- VibeShape can implement the sketcher without adopting the experimental SolveSpace web UI or its public state model.
- Horizontal and vertical dimensions use projected point distance against immutable sketch-axis entities. Concentric constraints use coincident center points. Radius input is represented through the native diameter equation.
- The repository carries GPL-3.0-or-later obligations for the adapted solver subset and must publish corresponding source and notices with distributed binaries.
- Solver upgrades require rerunning the entire evidence corpus, refreshing source and output hashes, reviewing the patch, and updating this decision through a new ADR when behavior or the boundary changes.
- SPK-002 proves solver viability, not the production sketch data model, profile detection, constraint UX, or branch-continuation policy. Those remain implementation work.

## Rejected alternatives

- **Embed the complete SolveSpace web application:** too broad, experimental, and incompatible with VibeShape's worker and domain ownership.
- **Use the upstream stateful Embind API directly:** easy to misuse, exposes native lifecycle assumptions, and starts with an unnecessarily large memory configuration.
- **Write a custom nonlinear solver now:** materially higher cost and risk without evidence that the reviewed SolveSpace subset is insufficient.
- **Run source builds in ordinary GitHub Actions:** consumes limited hosted minutes for work that is slow, platform-specific, and already controlled by local evidence commands.
