---
name: vibeshape-modeling
description: Create or edit parametric models in VibeShape using named MCP sketch, feature, and variable tools. Use for CAD authoring in the application, rather than changing VibeShape source code or generating geometry in another CAD engine.
---

# VibeShape modeling

Establish the session with [vibeshape-use](../vibeshape-use/SKILL.md) and follow [draft transactions](../vibeshape-use/references/transactions.md). Read [modeling contracts and recipes](references/modeling.md) for the requested feature family. Live schemas determine the exact input shape.

## Author or revise intent

Translate the request into dimensions, units, mating interfaces, target body, and acceptance measurements. Ask only for missing information that changes the design. For reversible choices, state a reasonable assumption and continue. Preserve protected interfaces and existing model intent.

Before constructing a new model or reconstructing a mesh, choose a feature plan using the construction strategy in [modeling contracts and recipes](references/modeling.md). Identify the main profile, actual symmetries, wall-thickness intent and local details. Discover required tools before writing; reconsider the plan after a server update exposes previously unavailable operations.

Read the relevant complete features, sketches, and variables before editing. Prefer changing an existing parameter or variable over reconstructing the model. Use named create/update tools inside a single draft for a coherent edit, followed by exact preview and the ordinary review/commit path. Do not make a new part beside an old one when the request is to revise the old part.

Use the [inspection skill](../vibeshape-inspection/SKILL.md) to choose targets and diagnose exact preview. Fix the failing feature or constraint; do not delete unrelated geometry or relax constraints simply to obtain a green result. Existing selected edge treatments and body-scoped holes must retain their selection scope.

## Capability boundaries

Current local and paired remote MCP cover Box, Cylinder, Cone, Sphere, Torus and Pyramid create/update; sketch, Extrude, Revolve, Hole, Fillet, Chamfer, Datum Plane, Boolean subtraction, Union, Compound, Mirror, linear/circular body Pattern, Shell, Split, Sweep, Loft, and custom Thread create/update; variables; inspection; drafts; feature/sketch removal; explicit feature suppression; project rename; and authored metadata. Arbitrary reference planes/axes use the additive `create_reference_*`/`update_reference_*` Mirror, Split and body Pattern tools; legacy names keep their original contracts. Check discovery before using any operation.

Placement and History navigation are not currently exposed as named CAD tools. Registered primitive tools and lifecycle tools use the contracts in the modeling reference; Wedge is not a registered primitive. Feature create/update tools carry explicit suppression intent; changing suppression is outside ordinary CAD auto-apply. Existing records may still be inspected and must survive supported upstream edits. Use the ordinary visible editor for a required unsupported operation when available and authorized; otherwise identify the exact limitation. A sketch-backed Extrude/Revolve is a valid alternative only when it preserves the requested design and editability.

In the visible editor, select a current exact Part or its body/face to reveal the main toolbar Part icons. Place / align faces can calculate a numeric Placement from two uniquely resolved planar faces on different current bodies, with opposing/same normals and a signed offset. Use Pick faces in viewport to pause the numeric preview before selecting the committed moving face. This editor calculator does not add a named MCP face-alignment tool or an associative mate; later target edits do not reposition the placed source. Do not advertise surface or curved-face mating.

## Accept the model

Before commit, compare exact bounds, volume, body count, intended feature parameters, and diagnostics with the requested outcome. Inspect visually when shape or spatial relationships cannot be established by these measurements. After commit, identify the saved revision and relevant changed parameters. Export or back up only when requested, using [vibeshape-export](../vibeshape-export/SKILL.md).
