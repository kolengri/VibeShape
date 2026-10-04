---
name: vibeshape-modeling
description: Create or edit parametric models in VibeShape using named MCP sketch, feature, variable, assembly, and local-library tools. Use for CAD authoring in the application, rather than changing VibeShape source code or generating geometry in another CAD engine.
---

# VibeShape modeling

Establish the session with [vibeshape-use](../vibeshape-use/SKILL.md) and follow [draft transactions](../vibeshape-use/references/transactions.md). Read [modeling contracts and recipes](references/modeling.md) for the requested feature family. For assemblies and reusable components, read [assembly and library transactions](references/assembly-and-library.md). Live schemas determine the exact input shape.
For editable printable relief, read [surface texture proposals](references/surface-textures.md). Their native preview and manual review are separate from a CAD draft.

## Author or revise intent

Translate the request into dimensions, units, mating interfaces, target body, and acceptance measurements. Ask only for missing information that changes the design. For reversible choices, state a reasonable assumption and continue. Preserve protected interfaces and existing model intent.

For modifying Revolve or Subtract on a Pattern/Split constituent, use the exact-body contracts in
[modeling contracts and recipes](references/modeling.md); preserve output roles and sibling Parts.

Before constructing a new model or reconstructing a mesh, choose a feature plan using the construction strategy in [modeling contracts and recipes](references/modeling.md). Identify the main profile, actual symmetries, wall-thickness intent and local details. Discover required tools before writing; reconsider the plan after a server update exposes previously unavailable operations.

Read the relevant complete features, sketches, and variables before editing. Prefer changing an existing parameter or variable over reconstructing the model. Use named create/update tools inside a single draft for a coherent edit, followed by exact preview and the ordinary review/commit path. Do not make a new part beside an old one when the request is to revise the old part.

Use the [inspection skill](../vibeshape-inspection/SKILL.md) to choose targets and diagnose exact preview. Fix the failing feature or constraint; do not delete unrelated geometry or relax constraints simply to obtain a green result. Existing selected edge treatments and body-scoped holes must retain their selection scope.

## Capability boundaries

For an authorized STEP/STP/BREP/STL/3MF source import, read [native source import](references/native-import.md).
Its upload, inspection and manual review flow is separate from CAD draft construction; it does not accept
caller source hashes or bypass ordinary atomic persistence.

For sketch-backed features, discover solved profile selectors with `model_sketch_solution` or `draft_sketch_solution` at the exact current revision. Inspect native status and failed constraint IDs when profiles are absent; never derive a persistent profile index from display order.

Current local and paired remote MCP cover Box, Cylinder, Cone, Sphere, Torus and Pyramid create/update; sketch, Extrude, Revolve, Hole, Fillet, Chamfer, Datum Plane, Boolean subtraction, Union, Compound, Mirror, linear/circular body Pattern, Shell, Split, Sweep, Loft, and custom Thread create/update; variables; assembly definitions/instances/mates; immutable local-library authoring; inspection; drafts; feature/sketch removal; explicit feature suppression; project rename; and authored metadata. Arbitrary reference planes/axes use the additive `create_reference_*`/`update_reference_*` Mirror, Split and body Pattern tools; legacy names keep their original contracts. Named Placement create/update and editable sketch text create/update/detach are also available. Check discovery before using any operation.

History navigation are not currently exposed as named CAD tools. Registered primitive tools and lifecycle tools use the contracts in the modeling reference; Wedge is not a registered primitive. Feature create/update tools carry explicit suppression intent; changing suppression is outside ordinary CAD auto-apply. Existing records may still be inspected and must survive supported upstream edits. Use the ordinary visible editor for a required unsupported operation when available and authorized; otherwise identify the exact limitation. A sketch-backed Extrude/Revolve is a valid alternative only when it preserves the requested design and editability.

In the visible editor, select a current exact Part or its body/face to reveal the main toolbar Part icons. Place / align faces can calculate a numeric Placement from two uniquely resolved planar faces on different current bodies, with opposing/same normals and a signed offset. Use Pick faces in viewport to pause the numeric preview before selecting the committed moving face. This editor calculator does not add a named MCP face-alignment tool or an associative mate; later target edits do not reposition the placed source. Do not advertise surface or curved-face mating.

## Accept the model

Before commit, compare exact bounds, volume, body count, intended feature parameters, and diagnostics with the requested outcome. Inspect visually when shape or spatial relationships cannot be established by these measurements. After commit, identify the saved revision and relevant changed parameters. Export or back up only when requested, using [vibeshape-export](../vibeshape-export/SKILL.md).
