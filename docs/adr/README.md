# Architecture Decision Records

| ADR | Статус | Решение |
|---|---|---|
| [0001](0001-occt-brep-kernel.md) | Accepted for spike | OCCT WASM как B-Rep kernel |
| [0002](0002-geometry-worker-boundary.md) | Accepted | CAD/WASM только в worker за protocol boundary |
| [0003](0003-parametric-dag-and-toporef.md) | Accepted | feature DAG и stable `TopoRef` |
| [0004](0004-local-first-storage.md) | Accepted | IndexedDB + OPFS + portable `.vshape` |
| [0005](0005-threejs-webgl2-viewport.md) | Accepted | raw Three.js/WebGL2 baseline |
| [0006](0006-3mf-primary-print-export.md) | Accepted | 3MF основной print export; slicer deferred |
| [0007](0007-gpl-project-license.md) | Accepted | GPL-3.0-or-later |
| [0008](0008-bun-workspaces.md) | Accepted | Bun workspaces, `bun.lock` и `bun ci` |
| [0009](0009-tailwind-shadcn-ui.md) | Accepted | Tailwind CSS v4 + shadcn/ui/Radix |

Статусы:

- `Proposed` — обсуждается;
- `Accepted for spike` — направление выбрано, конкретная реализация зависит от измеряемого spike;
- `Accepted` — обязательное решение;
- `Superseded` — заменено новым ADR;
- `Rejected` — рассмотрено и не принято.

ADR не переписывается задним числом при смене решения: создаётся новый record, а старый получает ссылку `Superseded by`.
