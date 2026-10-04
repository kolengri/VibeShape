# Expanded CAD delivery

## Authorized scope

The user authorized the full QymCAD-inspired capability comparison on 2026-10-03. This is a staged
implementation, not a claim that all capabilities are delivered. QymCAD is a behavioral reference;
VibeShape retains its browser-first TypeScript/Bun stack, project license, exact worker geometry,
revisioned commands, stable body/topology identity, local storage, and ordinary automation path.

## Delivery and acceptance

| Capability | State | Acceptance and limits |
| --- | --- | --- |
| Printer bed, height envelope, ground grid, placement and fit warnings | Implemented; reviewed | Validated local dimensions survive reload. Current placement and prepared copies include supports; design coordinates and History remain unchanged. |
| Lay a selected face on the print bed | Implemented; reviewed | Selected disposable mesh facets orient their outward normal down; regenerating the print copy preserves the design. |
| Exact topology measurements and section view | Implemented; browser verified | Analytical length, diameter, area, explicit point distance and meaningful pair angles/separation use revision-bound evidence. Section clipping is a view. |
| Solid Mirror and linear/circular patterns | Implemented; browser verified | Stable exact targets, deterministic instance roles, source-preserving native ownership, independent selection, edit, Undo/Redo and export. |
| Shell and Split body | Implemented; browser verified | Shell stores body-bound opening references and explicit repair; Split preserves exactly two connected positive-volume origin-plane pieces and durable Part fan-out. |
| Sweep and Loft | Implemented; browser verified | Exact analytical profile/path preparation, persisted selectors, variables, ordinary Apply/edit/Undo and export. Bounded hole-free sections and supported paths fail closed. |
| Modeled threads | Implemented; browser verified | Real internal/external custom 60-degree V geometry, pitch, hand, starts, clearance and run-in/out. At most 16 total authored turns; measured maximum rebuilds take tens of seconds. No ISO thread-fit claim. |
| Sketch text and splines | Implemented; browser verified | Durable exact cubic Bézier poles and ordinary editable text outlines from pinned Noto Sans. Fixed Latin/Greek/Cyrillic scalar layout; unsupported glyphs fail explicitly. |
| STEP/STL/3MF import | Implemented; browser verified | Exact source solids and explicitly labeled triangle meshes retain embedded immutable bytes, units and UUID outputs. Atomic import, Undo/Redo, native reopen and representation-appropriate export. Paired MCP adds 6 MiB bounded upload, explicit inspection and manual review; editor sources keep their separate 32 MiB cap. Meshes do not become exact solids. |
| DXF/SVG import | Implemented; browser verified | Supported analytical drawing curves use explicit units/planes and strict readonly inspection, ordinary editable sketch creation, durable source provenance, extrusion and STEP export. Unsupported entities reject the drawing. |
| Assemblies, joints and interference | Implemented; authoring and export browser verified | Frozen source definitions, independent placed instances, rigid/revolute/prismatic joints, degrees of freedom, limits and drives. Exact native intersections; overlapping mesh checks explicitly unsupported. |
| Local reusable parts library | Implemented; browser and three-engine storage verified | Search local names/tags, immutable versions, explicit copy/reference insertion, update/detach, corruption and optimistic-write failures, Undo/Redo and portable pinned sources. |

All remaining executable changes require integrated independent review before publication. These
capabilities implement the authorized comparison scope; they do not claim complete parity with every
operation subsequently listed in QymCAD's README. The reference remains
[QymCAD](https://github.com/QymIs-Tech/QymCAD); no third-party source or UI assets were copied.

## Durable boundaries

- Exact modeling uses the installed OCCT kernel and copied cached shapes. Unsupported native APIs
  do not become approximate CAD operations.
- Compound/Union schema v2 represents multiple ordered body roles from one producer while the DAG
  keeps unique producer dependencies. Schema v1 and canonical identity v0/v1 remain readable without
  migration; explicit editing may create v2 intent.
- Document V4 assets and frozen assembly authority extend published V3 texture authority and publish through ordinary revisioned transactions.
  Native format V5 retains full historical source closure; older formats remain readable.
- Print preparation transforms a disposable placed copy. It currently supports eight source bodies
  and the established triangle budget; ordinary assembly exports have separate bounded budgets.
- Local library publication is outside CAD History. Insert, explicit update and detach are ordinary
  undoable document transactions with portable frozen source closure.

Each slice includes applicable domain/kernel/worker tests, user-visible workflow evidence,
documentation, and independent approved review when substantial. UI buttons or registry rows alone
do not close a capability. The task branch may be committed, pushed and proposed as a PR after applicable checks and review.
Merge, deployment, other publication and paid services require separate authorization.
