# Feature specification

## Priorities

- **P0 / alpha:** required to prove the core workflow.
- **P1 / v1:** required for regular practical use.
- **P2 / later:** expansion after the core is stable.
- **Out:** intentionally outside the foreseeable scope.

## Projects and local-first behavior

| Capability | Priority | Completion condition |
|---|---:|---|
| Local project library | P0 | Card, preview, timestamp, duplicate, and confirmed deletion |
| Autosave and crash recovery | P0 | Transaction journal restores the latest confirmed command |
| `.vshape` import/export | P0 | Round-trip without losing parametrics |
| Save/Open through system picker | P1 | Progressive enhancement with mandatory download/upload fallback |
| Named snapshots/versions | P1 | Immutable snapshot with restore |
| Branching and merge | P2 | Only after a formal operation-conflict model exists |
| Cloud synchronization | P2 | Separate opt-in adapter, never a core dependency |

## Viewport and navigation

| Capability | Priority | Notes |
|---|---:|---|
| Orbit, pan, zoom, fit, standard views | P0 | Predictable CAD mouse and trackpad presets |
| Perspective and orthographic modes | P0 | Orthographic by default in sketch mode |
| Body, face, edge, and vertex selection | P0 | Selection filters and hover preselection |
| Shaded, edges, and wireframe modes | P0 | No CAD retessellation required |
| Grid, axes, and origin planes | P0 | Visible units and grid spacing |
| Section/clipping plane | P1 | One interactive plane |
| Exploded view | P2 | Depends on assemblies |
| WebGPU renderer | P2 | Experimental adapter, not the baseline |

## Sketcher

| Capability | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Point, line/polyline, rectangle | ✓ |  |  |
| Circle, center/three-point arc | ✓ |  |  |
| Construction geometry, trim, extend | ✓ |  |  |
| Slot, polygon, ellipse, spline |  | ✓ |  |
| Project/use edge |  | ✓ |  |
| Text and SVG contours |  | ✓ |  |
| Offset sketch entities |  | ✓ |  |
| Sketch patterns and mirror |  | ✓ |  |
| 3D sketch |  |  | ✓ |

Required P0 constraints:

- coincidence;
- horizontal/vertical;
- parallel/perpendicular;
- equal;
- tangent;
- concentric;
- point-on-line/curve;
- fixed;
- horizontal, vertical, and general distance;
- angle;
- radius/diameter.

The solver MUST report `under-constrained`, `fully-constrained`, and `over-constrained`, including the conflicting constraint set where possible. Automatically deleting constraints without confirmation is prohibited.

## Parametric 3D features

| Operation | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Extrude: new/add/remove/intersect | ✓ |  |  |
| Revolve: new/add/remove/intersect | ✓ |  |  |
| Boolean union/cut/common | ✓ |  |  |
| Fillet/chamfer | ✓ |  |  |
| Mirror feature/body |  | ✓ |  |
| Linear/circular pattern |  | ✓ |  |
| Shell |  | ✓ |  |
| Sweep/pipe |  | ✓ |  |
| Loft |  | ✓ |  |
| Draft, split, replace face |  |  | ✓ |
| Direct face move/delete |  |  | ✓ |
| Surface modeling |  |  | ✓ |

Every feature requires:

- a stable `FeatureId`;
- typed parameters with units;
- inputs referenced through `TopoRef`/`EntityRef`;
- `active`, `suppressed`, or `error` state;
- a diagnostic message;
- a deterministic input hash;
- atomic apply and cancel behavior.

## Variables and expressions

P1 includes:

- named document variables;
- arithmetic with `+ - * / ^` and parentheses;
- literals using `mm`, `cm`, `m`, `in`, `deg`, and `rad`;
- `min`, `max`, `abs`, `round`, `sin`, `cos`, and `tan`;
- dimensional checking: a length cannot be added to a dimensionless number;
- cycle detection;
- `.` as the serialized decimal separator, with localized UI input.

Arbitrary JavaScript is prohibited in documents. Native files must not be executable.

## Bodies, parts, and assemblies

| Capability | Priority |
|---|---:|
| Multiple bodies in one document | P0 |
| Visibility, color, name, material label | P0 |
| Multi-body boolean | P0 |
| Components/instances | P1 |
| Simple rigid transforms | P1 |
| Assemblies and mates | P2 |
| BOM | P2 |
| Drawings | P2 |

## Measurement and analysis

- P0: point-to-point and minimum distance, edge length, angle, radius/diameter, face area, body volume, bounding box, and center of mass.
- P0: OCCT shape validity and closed-solid checks.
- P0: mesh manifoldness, inverted/degenerate triangles, and disconnected shells.
- P1: approximate minimum wall, minimum hole/feature, overhang visualization, build-volume collision, and clearance/interference.
- P2: tolerance stack, draft analysis, material-density mass, and basic FEA adapter.

A printability warning is a heuristic, not a guarantee of a successful print.

## Import and export

| Format | Import | Export | Role |
|---|---:|---:|---|
| `.vshape` | P0 | P0 | Parametric native project |
| STEP AP242/AP214 | P0 | P0 | Exact B-Rep exchange |
| Binary STL | P0 | P0 | Mesh compatibility |
| 3MF Core | P1 in alpha, P0 for v1 | P0 | Primary printing exchange |
| SVG/DXF 2D | P1 | P1 | Sketches and templates |
| OBJ/glTF | P2 | P2 | Visual mesh workflows |
| IGES | P2 | P2 | Legacy CAD |
| Proprietary CAD | Out | Out | Requires commercial SDKs or converters |

STL import creates a `MeshBody`, not a fake exact `SolidBody`. Automatic mesh-to-B-Rep conversion is not promised.

## Undo, redo, and history

- P0: undo/redo at user-command granularity, not per pointer event.
- P0: edit an early feature and rebuild downstream features.
- P0: suppress/unsuppress.
- P1: reorder with DAG validation.
- P1: compare two snapshots by feature, parameter, and geometry metrics.
- P2: branch/merge.

## Interface and accessibility

- All interface work follows the normative [Design and UX Guidelines](design-and-ux-guidelines.md).
- Desktop-first, minimum working width of 1024 px.
- Every core action is available through commands/shortcuts and the command palette.
- Focus indicators, semantic labels, and keyboard-operable dialogs.
- State color is reinforced with shape, iconography, or text.
- Save, export, rebuild, solver, and topology failures remain persistent and recoverable rather than toast-only.
- Application chrome targets WCAG 2.2 AA; free-form canvas-authoring limitations are documented explicitly.
- Touch/tablet authoring comes later; phones are view/export-only.
- The architecture supports localization, but alpha may ship with one language.

## Explicitly deferred

- Marketplace/plugins and untrusted code execution.
- Real-time multi-user editing.
- Direct G-code delivery to printers.
- Generative or AI CAD before a deterministic command API and sandbox exist.
- Claims of complete compatibility with Onshape, FreeCAD, or SolidWorks.
