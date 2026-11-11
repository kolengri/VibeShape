# Thicken

Select a part, choose **Thicken**, pick the faces to thicken, enter a thickness, and choose a side and
a result. Faces are toggled by clicking them in 3D or by expanding the face list and checking its rows;
each row exposes the face area and center on hover or keyboard focus. Planar and curved faces are
supported. The selected faces must form one connected patch: every face shares an edge with another
selected face.

**Side** is relative to the outward face normals. **Outward** grows the solid away from the part,
**Inward** grows it into the part, and **Both sides, split evenly** puts half of the thickness on each
side. The thickness accepts unit-aware expressions and `#variables` and must be from 0.001 to 10,000
mm. On a curved face the thickness on the concave side must stay below the curvature radius: an inward
thickness on a cylinder of radius 5 mm must be less than 5 mm, and an outward thickness on a hole wall
of radius 5 mm likewise. The preview fails with the face number and the limiting radius otherwise.

**Result** chooses what happens to the part:

- **New body** keeps the part unchanged and adds the thickened solid as a separate body.
- **Add to part** joins the thickened region to the part. It fails if the region lies entirely inside
  the part.
- **Remove from part** cuts the thickened region from the part. It fails if the region lies entirely
  outside the part.

A single face, or faces that meet tangentially, get side walls along the face normals at the patch
boundary. Faces that meet at sharp edges are offset so that neighbouring offsets extend to meet each
other; the free side walls of such a patch then follow the neighbouring faces of the part, which
matches the normal walls when those neighbours are perpendicular to the selection.

The disposable preview contains one valid solid, and Apply is disabled while it evaluates and runs
once per click. Every selected face is thickened: when OCCT cannot offset a face, the preview fails
and the task panel explains why instead of skipping the face. Cancel discards the preview. Editing,
Undo/Redo, native `.vshape` reopen and exports use the ordinary feature lifecycle. If the source
body's feature is deleted while Thicken is retained, opening Thicken offers an earlier replacement
body; thickness, side and result are kept, while faces must be selected again on the replacement.

Agents use `create_thicken` and `update_thicken`. See
[ADR-0159](../adr/0159-thicken-and-curved-face-offset.md) for the kernel construction and its
limits.
