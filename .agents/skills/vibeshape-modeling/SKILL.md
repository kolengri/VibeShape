---
name: vibeshape-modeling
description: Create or edit parametric models in VibeShape using named MCP sketch, feature, variable, assembly, and local-library tools. Use for CAD authoring in the application, rather than changing VibeShape source code or generating geometry in another CAD engine.
---

# VibeShape modeling

Establish the session with [vibeshape-use](../vibeshape-use/SKILL.md) and follow [draft transactions](../vibeshape-use/references/transactions.md). Read [modeling contracts and recipes](references/modeling.md) for the requested feature family. For assemblies and reusable components, read [assembly and library transactions](references/assembly-and-library.md). Live schemas determine the exact input shape.
For editable printable relief, read [surface texture proposals](references/surface-textures.md). Their native preview and approval path are separate from a CAD draft.
For minimum-mass or stiffness-guided material reduction under explicit loads, stress and displacement limits, read
[structural lightweighting](references/lightweighting.md). Both local and paired remote MCP use
the browser numerical worker; a result is a separate mesh snapshot using the connection's approval policy.
For material removal without prescribed loads, read [quick load-free lightweighting](references/quick-lightweighting.md).
Its Gyroid, Schwarz P and Schwarz D geometry reports measured removal and makes no structural performance claim.

## Choose design guidance by purpose

| Purpose | Guidance to load |
| --- | --- |
| Every CAD model | The common intent rules below and [modeling contracts and recipes](references/modeling.md) |
| Functional parts, load-bearing details, fits, or mechanisms | [Mechanical design](references/mechanical-design.md) |
| Models intended for 3D printing | [3D-printing design](references/3d-printing.md), using the section for the intended process |
| Printed insert lids, corner binding, or compliant perimeter retention | [Lid fits and compliant retention](references/lid-fits.md) |
| Assemblies or reusable components | [Assembly and library transactions](references/assembly-and-library.md) |

Combine applicable categories: a printed latch needs both mechanical and printing guidance. Apply manufacturing rules only when the intended process is established; preserve requested appearance and exact source geometry for visualization or reconstruction. For another manufacturing process, use its current process-specific guidance instead of importing FDM rules.

## Author or revise intent

Translate the request into dimensions, units, mating interfaces, target body, and acceptance measurements. Ask only for missing information that changes the design. For reversible choices, state a reasonable assumption and continue. Preserve protected interfaces and existing model intent.

Make all editable design dimensions and numeric controls variable-driven by default: lengths, thicknesses, diameters/radii, clearances, offsets, angles, and supported counts. Create or reuse named document variables before their consumers, and retain `#name` references or derived expressions in sketch constraints and feature quantities instead of baking in evaluated numbers. Follow the Variables section of [modeling contracts and recipes](references/modeling.md), including expression support limits and editability checks.

For modifying Revolve or Subtract on a Pattern/Split constituent, use the exact-body contracts in
[modeling contracts and recipes](references/modeling.md); preserve output roles and sibling Parts.

Before constructing a new model or reconstructing a mesh, choose a feature plan using the construction strategy in [modeling contracts and recipes](references/modeling.md). Identify the main profile, actual symmetries, wall-thickness intent and local details. Before writing sketch entities, explicitly decide whether the profile has a supported symmetry axis and how that symmetry will remain associative. Prefer dimensioning one half and constraining its reflected half; explain any need for independently dimensioned halves. Follow the sketch symmetry recipe in the construction strategy, including Bezier control points. Discover required tools before writing; reconsider the plan after a server update exposes previously unavailable operations.

Read the relevant complete features, sketches, and variables before editing. Prefer changing an existing parameter or variable over reconstructing the model. Use named create/update tools inside a single draft for a coherent edit, followed by exact preview and the ordinary review/commit path. Do not make a new part beside an old one when the request is to revise the old part.

Plan the final independent parts before creating construction solids. A container and its removable lid
normally remain two independent terminal solids; do not fuse them together to reduce a browser count.
Fuse attached details into their intended part and subtract cutters with the appropriate tool-retention
setting. Prefer one associative pattern over manually copying the same detail. Inspect `model_parts`
and exact body measurements after committing a stage: consumed construction parts and History entries
are not additional printable components. Report the terminal part/body count separately from the
number of authored operations.

For a correction, update the existing primitive, sketch, feature, or variable through its available
named `update_*` or variable tool, retaining its ID and dependencies. Do not append another feature
merely to compensate for an editable parameter. When history cleanup is explicitly requested, inspect
dependencies and consumers first; use supported `remove_feature`, `remove_sketch`, or suppression only
for verified redundant intent and validate the complete result before committing. Do not silently
delete user-authored intent, flatten editable geometry, or claim arbitrary History reordering or
automatic feature consolidation: those operations are not exposed by the organization tools. History
folders organize a contiguous range without changing feature order or geometry.

Use the [inspection skill](../vibeshape-inspection/SKILL.md) to choose targets and diagnose exact preview. Fix the failing feature or constraint; do not delete unrelated geometry or relax constraints simply to obtain a green result. Existing selected edge treatments and body-scoped holes must retain their selection scope.

## Capability boundaries

For an authorized STEP/STP/BREP/STL/3MF source import, read [native source import](references/native-import.md).
For SVG/DXF editable sketch import, read [planar source import](references/planar-import.md).
Its upload, inspection and approval flow is separate from CAD draft construction; it does not accept
caller source hashes or bypass ordinary atomic persistence.

For sketch-backed features, discover solved profile selectors with `model_sketch_solution` or `draft_sketch_solution` at the exact current revision. Inspect native status and failed constraint IDs when profiles are absent; never derive a persistent profile index from display order.

Current local and paired remote MCP cover Box, Cylinder, Cone, Sphere, Torus and Pyramid create/update; sketch, Extrude, Revolve, Hole, Fillet, Chamfer, Datum Plane, Boolean subtraction, Union, Compound, Mirror, linear/circular body Pattern, Shell, Split, Sweep, Loft, custom Thread, and the twelve-kind FDM family create/update; variables; assembly definitions/instances/mates; immutable local-library authoring; inspection; drafts; feature/sketch removal; explicit feature suppression; project rename; and authored metadata. Arbitrary reference planes/axes use the additive `create_reference_*`/`update_reference_*` Mirror, Split and body Pattern tools; legacy names keep their original contracts. Named Placement create/update and editable sketch text create/update/detach are also available. Check discovery before using any operation.

For printed-part reinforcement, reliefs, fastener fits, enclosure joints, membranes, and calibration coupons, follow the FDM section of [modeling contracts and recipes](references/modeling.md).

For committed Undo/Redo, follow the [saved-change History workflow](../vibeshape-organization/SKILL.md). Registered primitive tools and lifecycle tools use the contracts in the modeling reference; Wedge is not a registered primitive. Feature create/update tools carry explicit suppression intent; supported CAD suppression and removal use an existing explicit auto-apply grant. Existing records may still be inspected and must survive supported upstream edits. Use the ordinary visible editor for a required unsupported operation when available and authorized; otherwise identify the exact limitation. A sketch-backed Extrude/Revolve is a valid alternative only when it preserves the requested design and editability.

In the visible editor, select a current exact Part or its body/face to reveal the main toolbar Part icons. Place / align faces can calculate a numeric Placement from two uniquely resolved planar faces on different current bodies, with opposing/same normals and a signed offset. Use Pick faces in viewport to pause the numeric preview before selecting the committed moving face. This editor calculator does not add a named MCP face-alignment tool or an associative mate; later target edits do not reposition the placed source. Do not advertise surface or curved-face mating.

## Accept the model

Before commit, compare exact bounds, volume, body count, intended feature parameters, and diagnostics with the requested outcome. Use `render_preview` for the owned draft after meaningful construction steps and before acceptance when shape or spatial relationships matter; follow [visual inspection](../vibeshape-inspection/SKILL.md). Repair discrepancies and repeat the affected numerical and visual checks at the new revision. After commit, identify the saved revision and relevant changed parameters. Export or back up only when requested, using [vibeshape-export](../vibeshape-export/SKILL.md).
