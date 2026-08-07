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

Statuses:

- `Proposed` — under discussion
- `Accepted for spike` — direction selected, while the concrete implementation depends on a measurable spike
- `Accepted` — binding project decision
- `Superseded` — replaced by a newer ADR
- `Rejected` — considered and not adopted

When a decision changes, do not rewrite its ADR retroactively. Create a new record and add a `Superseded by` link to the old record.
