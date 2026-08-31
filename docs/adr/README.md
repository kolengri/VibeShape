# Architecture Decision Records

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-occt-brep-kernel.md) | Accepted for spike | OCCT WASM as the B-Rep kernel |
| [0002](0002-geometry-worker-boundary.md) | Accepted | CAD and WASM run only in a worker behind a protocol boundary |
| [0003](0003-parametric-dag-and-toporef.md) | Accepted | Feature DAG and stable `TopoRef` |
| [0004](0004-local-first-storage.md) | Accepted | IndexedDB, OPFS, and portable `.vshape` files |
| [0005](0005-threejs-webgl2-viewport.md) | Accepted | Raw Three.js with a WebGL2 baseline |
| [0006](0006-3mf-primary-print-export.md) | Accepted | 3MF as the primary print export; slicer deferred |
| [0007](0007-gpl-project-license.md) | Accepted | GPL-3.0-or-later |
| [0008](0008-bun-workspaces.md) | Accepted | Bun workspaces, `bun.lock`, and `bun ci` |
| [0009](0009-tailwind-shadcn-ui.md) | Accepted | Tailwind CSS v4 with shadcn/ui and Radix |
| [0010](0010-uncontrolled-form-primitives-and-tanstack-form.md) | Accepted | Uncontrolled-first form primitives with TanStack Form adapters |
| [0011](0011-use-intl-localization-layer.md) | Accepted | `use-intl` localization for the static React application |
| [0012](0012-capability-based-extension-platform.md) | Accepted with reduced scope | Capability-based, version-pinned extension profiles; no arbitrary workspace JavaScript |
| [0013](0013-microkernel-modules-and-mcp-automation.md) | Proposed | Microkernel feature modules and MCP over the ordinary command path |
| [0014](0014-solvespace-flat-wasm-solver.md) | Accepted | SolveSpace v3.2 subset behind a flat worker-owned WASM ABI |
| [0015](0015-document-variables-and-dimensional-expressions.md) | Accepted | Document variables, dimensional expression schema v0, and resolved feature identity |
| [0016](0016-persisted-document-session-and-rebuild-sequencing.md) | Accepted | Persisted document sessions save semantic revisions before rebuilding derived geometry |
| [0017](0017-atomic-variable-rename-and-reference-refactor.md) | Accepted | Stable-ID variable rename with atomic exact-reference refactoring |
| [0018](0018-deterministic-sketch-profile-extraction.md) | Accepted | Deterministic bounded sketch profiles with fail-closed ambiguity handling |
| [0019](0019-selector-backed-new-body-extrusion.md) | Accepted | Stable sketch-profile selectors and transient analytical content for exact new-body extrusion |
| [0020](0020-local-slicer-handoff-bridge.md) | Accepted | Authenticated loopback bridge with remembered slicer choice and download fallback |
| [0021](0021-transient-sketch-draft-solving.md) | Accepted | Exact-revision worker solving for complete, non-persisted sketch drafts |
| [0022](0022-project-display-unit-preferences.md) | Accepted | Revisioned project display units with canonical millimeter/radian geometry |
| [0023](0023-explicit-target-extrusion-operations.md) | Accepted | New/add/remove/intersect extrusion with an explicit terminal-feature target dependency |
| [0024](0024-stable-planar-face-sketch-support.md) | Accepted | Stable planar-face sketch support with separate evaluation and body dependencies |
| [0025](0025-first-class-offset-datum-planes.md) | Accepted | First-class signed offset datum planes that remain outside body ownership and export |
| [0026](0026-document-dependency-graph-and-interleaved-history.md) | Accepted | A document-wide sketch/feature dependency graph with replay-safe interleaved History |
| [0027](0027-typed-orphan-model-reference-intent.md) | Accepted | Typed orphan intent for model-backed sketch references after feature deletion |
| [0028](0028-selector-backed-origin-axis-revolve.md) | Accepted | Selector-backed new-body Revolve around a sketch-local origin axis |
| [0029](0029-exact-bounded-elliptical-arc-locus.md) | Accepted | Exact positive-sweep Point on elliptical arc intent behind the reviewed solver ABI |
| [0030](0030-explicit-target-revolve-operations.md) | Accepted | New/add/remove/intersect Revolve with an explicit terminal-feature target dependency |
| [0031](0031-stable-sketch-line-revolve-axis.md) | Accepted | Stable graphical same-sketch line axes for exact Revolve replay |
| [0032](0032-stable-linear-model-edge-revolve-axis.md) | Accepted | Stable straight model-edge axes for exact Revolve replay |
| [0033](0033-selector-backed-saved-profile-picking.md) | Accepted | Stable saved-sketch profile picking through disposable 3D render regions |

Statuses:

- `Proposed` — under discussion
- `Accepted for spike` — direction selected, while the concrete implementation depends on a measurable spike
- `Accepted` — binding project decision
- `Accepted with reduced scope` — binding only for the explicitly accepted subset; named gates remain closed
- `Superseded` — replaced by a newer ADR
- `Rejected` — considered and not adopted

When a decision changes, do not rewrite its ADR retroactively. Create a new record and add a `Superseded by` link to the old record.
