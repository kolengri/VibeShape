# VibeShape documentation

## Recommended reading order

1. [Product vision and scope](product/vision-and-scope.md).
2. [Feature matrix](product/feature-matrix.md).
3. [Design and UX guidelines](product/design-and-ux-guidelines.md), [core flows](product/ux-flows.md), the [editor experience plan](product/editor-experience-plan.md), the [sketch precision toolset](product/sketch-toolset.md), and the [sketch-first modeling plan](product/sketch-first-modeling-plan.md).
4. [Architecture overview](architecture/overview.md).
5. [Technology stack](architecture/technology-stack.md) and [Codex agent team](codex-agent-team.md).
6. [UI system](architecture/ui-system.md), [UI component contracts](architecture/ui-component-contracts.md), [internationalization](architecture/internationalization.md), and [geometry/parametrics](architecture/geometry-and-parametrics.md).
7. [Extension architecture](architecture/extensions.md), [automation and MCP](architecture/automation-and-mcp.md), and [data model/native format](architecture/data-model-and-file-format.md).
8. [Roadmap](roadmap.md), [initial experiments](implementation-blueprint.md), [SPK-001 OCCT worker evidence](spikes/spk-001-occt-worker.md), [SPK-002 solver evidence](spikes/spk-002-sketch-solver.md), [SPK-003 stable topology evidence](spikes/spk-003-toporef.md), [SPK-004 3MF evidence](spikes/spk-004-3mf.md), [SPK-005 local-first evidence](spikes/spk-005-local-first.md), [SPK-006 extension evidence](spikes/spk-006-extension-sandbox.md), and [testing strategy](testing-strategy.md).
9. [Deployment](deployment.md), [ADRs](adr/README.md), [risks](risks.md), [licensing](licensing.md), and [research sources](research-sources.md).

## Requirement levels

The documents use these terms:

- **MUST** — required for the specified release.
- **SHOULD** — expected behavior; deviation requires a documented reason in an issue or ADR.
- **MAY** — an acceptable extension.
- **Spike** — a bounded experiment that ends with a measurable decision, not production code.

## Accepted decisions

- Local-first architecture without a mandatory backend.
- B-Rep/STEP through OCCT WASM; Three.js is not used as the CAD kernel.
- CAD objects exist only inside a worker; the UI receives serializable data and mesh buffers.
- Sketch solving uses the source-built SolveSpace v3.2 subset behind a flat typed-array worker ABI; no native pointer crosses it.
- Parametric history is a directed acyclic dependency graph with a linear presentation in the UI.
- The document length unit is millimeters; calculations use `float64`.
- 3MF is the preferred print export.
- Installed-slicer handoff uses an explicitly paired, authenticated `127.0.0.1` bridge with an honest 3MF download fallback.
- The monorepo is managed with Bun workspaces; Vite remains the browser bundler.
- UI primitives live in `@vibeshape/ui` and use Tailwind CSS v4 with shadcn/ui/Radix.
- Form controls are uncontrolled-first primitives with separate TanStack Form adapters.
- Product copy uses typed ICU catalogs through the local-first `@vibeshape/i18n` layer.
- Topology-reference failures are never repaired silently; ambiguity is visible to the user.
- Sketch-driven features persist stable boundary selectors; solved coordinates and transient profile indices remain disposable worker data.
- Extension packages and document locks use exact integrity; the accepted executable candidate is no-import WebAssembly with opaque-origin iframe UI, not arbitrary workspace JavaScript.
- English is the canonical language for documentation and code comments.

## Proposed decisions

- Product functionality follows a microkernel plus cohesive first-party module model; modularity does not make trusted kernel services installable extensions.
- MCP is a local external adapter over bounded resources and the ordinary draft/command path, not a privileged document mutation API.

## Decisions to confirm in Phase 0

SPK-001 is **Pass — Phase 0 stop/go gate cleared**. Its controlled package is built from verified archives with the reviewed destructor correction; all 1,000-operation lifecycle blocks retain zero bytes, post-warmup live allocation drifts by 448 bytes across four further full batches, worker initialization p95 is 178.5 ms, and complete-fixture p95 is 278.8 ms on the declared Apple M1 baseline. Headless FreeCAD 1.1.3 imports the exact browser STEP output as one valid solid with matching volume and bounds. The controlled artifact remains quarantined until the production facade and extended corpus are reviewed.

SPK-002 is **Pass — solver selection gate cleared and exact output promoted**. The project source-builds the pinned SolveSpace v3.2 subset behind a flat typed-array ABI, covers every P0 constraint primitive, classifies fully, under-, and over-constrained systems with a conflict set, completes 1,600 perturbation solves and 1,000 lifecycle cycles, runs in a Chromium module worker, and produces byte-identical outputs across consecutive clean builds. The exact reviewed module and WASM are now consumed lazily by the production document worker through protocol v8, including complete non-persisted draft solves and compound signed line-chain Offset constraints and verified by SHA-256 before the ordinary repository gate. ADR-0018 adds deterministic endpoint-connected analytical profiles, nesting, limits, and fail-closed diagnostics to the same solve response.

SPK-003 is **Pass — stable-reference algorithm gate cleared**. Protocol v5 carries semantic roles, durable face-lineage tokens, and geometry signatures without native handles or persistent transient hashes. The local Chromium corpus rebuilds 12 boolean, fillet, pattern, suppression, restoration, and symmetry scenarios with zero false confident matches. Production feature-DAG integration, repair events, persistence, and broader property-based models remain implementation work rather than unresolved algorithm selection.

SPK-004 is **Pass — minimal 3MF writer and slicer gate cleared**. The project-owned Core writer produces byte-identical millimeter archives with strict mesh, reference, transform, XML, thumbnail, and resource validation. PrusaSlicer and the Orca/Bambu family consume the local fixture and agree on 24 manifold facets and `1,608 mm³`; the evidence command rejects CI and has no GitHub Actions workflow.

SPK-005 is **Pass — semantic persistence and recovery gate cleared; installed-build update validation remains**. Dexie transactions atomically persist strict event, snapshot, project-head, and recovery records; checksum replay, one-writer lease epochs, forced-page recovery, quota rollback, service-worker offline reopen, and progressive OPFS/file fallbacks pass the local Chromium, Firefox, and WebKit matrix. The recorded WebKit runtime exposes but cannot open OPFS, so derived caching degrades without blocking semantic documents. The evidence command rejects CI and has no GitHub Actions workflow.

SPK-006 is **Proceed with reduced scope**. Strict immutable packages, exact locks, deterministic no-import WebAssembly, deny/grant/revoke policy, opaque-origin iframe UI, resource termination, and restricted states pass locally in Chromium, Firefox, and WebKit. Arbitrary same-origin workspace JavaScript is rejected because the worker retains ambient browser authority. A public SDK and product execution remain blocked on the production modeling ABI, memory policy, document integration, update/rollback, and recovery gates.

- Promotion of the exact controlled OCCT build and 262-binding set after the remaining release gates.
- Whether Replicad is the production facade or only the prototype facade.
- Interior-intersection splitting, Trim/Extend/Split, guided conflict repair, multi-region feature input, and inference modes beyond the implemented nearby-point and horizontal/vertical slice.
- Configurable 3MF print profiles, placement, progress, cancellation, persistent reports, and release slicer UX around the implemented production export path.
- Real startup, memory, rebuild, and representative large-project storage budgets.
- Production extension modeling ABI, portable memory policy, document integration, package governance, and recovery rebuilds on the accepted reduced-scope seams.

## Decision-change rule

Changing the CAD kernel, solver, license, native format, history model, local-first boundary, extension trust boundary, or external automation authority requires a new ADR. Updating a package within an accepted decision is normal dependency work.
