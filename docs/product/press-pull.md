# Press Pull

Select a face of an exact part and choose **Press Pull** (Q), or use **Press Pull** in the viewport
selection actions. Enter a signed distance: positive distances move the face outward along its normals
and extend the part; negative distances move it inward and cut the part. The distance accepts
unit-aware expressions and `#variables`, with a magnitude from 0.001 to 100,000 mm.

**Planar faces** sweep the complete trimmed face, including its holes, along the face normal and fuse
or cut the swept prism.

**Curved faces** (cylindrical, conical, spherical, toroidal or freeform) move exactly along their
normals, so a cylindrical boss or hole changes radius and a spherical dome grows or shrinks. The
neighbouring faces must stay attached:

- neighbours that meet the face at right angles, such as the caps of a boss or the plate around a
  hole, continue along the moved face;
- neighbours that extend along their own surfaces, such as the planar caps of a cone frustum, extend
  or trim to meet it.

A curved face whose neighbour meets it tangentially, for example a cylinder blending into a dome or a
fillet, cannot be moved this way: the preview fails with that reason and suggests Thicken with
**Add to part** or **Remove from part** instead. On the concave side of a curved face the distance must
stay below its curvature radius.

The disposable preview contains one valid solid; Apply is disabled while it evaluates and runs once.
Editing, Undo/Redo, native `.vshape` reopen and exports use the ordinary feature lifecycle. New Press
Pull features use version 2; documents saved with version 1 keep their planar-only contract.

Agents use `create_press_pull` and `update_press_pull`, which author version 2. See
[ADR-0159](../adr/0159-thicken-and-curved-face-offset.md) for the construction, the attachment rule
and the investigation of a general offset-face operation.
