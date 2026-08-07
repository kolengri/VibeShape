# VibeShape documentation

## Recommended reading order

1. [Product vision and scope](product/vision-and-scope.md).
2. [Feature matrix](product/feature-matrix.md).
3. [Design and UX guidelines](product/design-and-ux-guidelines.md) and [core flows](product/ux-flows.md).
4. [Architecture overview](architecture/overview.md).
5. [Technology stack](architecture/technology-stack.md).
6. [UI system](architecture/ui-system.md), [UI component contracts](architecture/ui-component-contracts.md), [internationalization](architecture/internationalization.md), and [geometry/parametrics](architecture/geometry-and-parametrics.md).
7. [Extension architecture](architecture/extensions.md), [automation and MCP](architecture/automation-and-mcp.md), and [data model/native format](architecture/data-model-and-file-format.md).
8. [Roadmap](roadmap.md), [initial experiments](implementation-blueprint.md), [SPK-001 OCCT worker evidence](spikes/spk-001-occt-worker.md), and [testing strategy](testing-strategy.md).
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
- Parametric history is a directed acyclic dependency graph with a linear presentation in the UI.
- The document length unit is millimeters; calculations use `float64`.
- 3MF is the preferred print export.
- The monorepo is managed with Bun workspaces; Vite remains the browser bundler.
- UI primitives live in `@vibeshape/ui` and use Tailwind CSS v4 with shadcn/ui/Radix.
- Form controls are uncontrolled-first primitives with separate TanStack Form adapters.
- Product copy uses typed ICU catalogs through the local-first `@vibeshape/i18n` layer.
- Topology-reference failures are never repaired silently; ambiguity is visible to the user.
- English is the canonical language for documentation and code comments.

## Proposed decisions

- Third-party extensibility uses separate deterministic feature, capability-based workspace, and bounded compute profiles.
- Extension artifacts are immutable and exact-version/integrity pinned; `.vshape` records requirements but never executes embedded code.
- A public extension API remains blocked on `SPK-006` isolation, termination, permissions, compatibility, and recovery evidence.
- Product functionality follows a microkernel plus cohesive first-party module model; modularity does not make trusted kernel services installable extensions.
- MCP is a local external adapter over bounded resources and the ordinary draft/command path, not a privileged document mutation API.

## Decisions to confirm in Phase 0

SPK-001 has a **Rework** result: required browser operations pass, but exact OCCT build provenance and allocator-level memory evidence remain unresolved.

- Exact OCCT build/version and exported binding set.
- Whether Replicad is the production facade or only the prototype facade.
- Suitability of the SolveSpace solver subset as a standalone WASM module.
- `TopoRef` matching algorithm and thresholds.
- 3MF implementation: a minimal project-owned writer or an adapted library.
- Real startup, memory, rebuild, and storage budgets.
- Extension sandbox runtime, package schema, capability contract, and cross-browser resource budgets.

## Decision-change rule

Changing the CAD kernel, solver, license, native format, history model, local-first boundary, extension trust boundary, or external automation authority requires a new ADR. Updating a package within an accepted decision is normal dependency work.
