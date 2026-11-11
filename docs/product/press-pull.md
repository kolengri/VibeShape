# Press Pull

Select a face of an exact part and choose **Press Pull** (Q), or use **Press Pull** in the viewport
selection actions. Enter a signed distance: positive distances move the face outward along its normals
and extend the part; negative distances move it inward and cut the part. The distance accepts
unit-aware expressions and `#variables`, with a magnitude from 0.001 to 100,000 mm.

**Planar faces** sweep the complete trimmed face, including its holes, along the face normal and fuse
or cut the swept prism. New planar Press Pull features are saved as version 1, which keeps this
behaviour and its preview advice unchanged.

**Curved faces** (cylindrical, conical, spherical, toroidal or freeform) move exactly along their
normals, so a cylindrical boss or hole changes radius and a spherical dome grows or shrinks. They are
saved as version 2. The faces next to the moved face must stay attached, and only **planar**
neighbours can follow it:

- a planar neighbour that meets the face at a right angle, such as the cap of a boss or the plate
  around a hole, grows or shrinks with it;
- a planar neighbour at another angle, such as a cap of a cone frustum, extends or trims along its
  own plane to meet the moved face.

A curved neighbour cannot follow. A chamfer (a conical neighbour), a fillet, a cylinder blending into a
dome, or any other curved neighbour makes the preview fail with that reason and suggests Thicken with
**Add to part** or **Remove from part** instead. The move also fails when it would consume another
face of the part, for example the floor of a counterbore, or when the moved face would merge into a
face other than its own neighbour. Every result is checked against the operation history, not only
its face count. On the concave side of a curved face the distance must stay below its curvature
radius.

The disposable preview contains one valid solid; Apply is disabled while it evaluates and runs once.
Editing changes only the distance and keeps the saved version. Undo/Redo, native `.vshape` reopen
and exports use the ordinary feature lifecycle. Documents saved with version 1 keep their planar-only
contract.

Agents use `create_press_pull` and `update_press_pull`: creation picks version 1 for a planar face and
version 2 for a curved face, and an update keeps the saved version. See
[ADR-0159](../adr/0159-thicken-and-curved-face-offset.md) for the construction, the attachment proof
and the investigation of a general offset-face operation.
