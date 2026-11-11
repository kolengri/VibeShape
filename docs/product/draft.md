# Draft

Select a part, choose **Draft**, pick the faces to taper, choose a neutral plane, and enter an angle.
Faces are toggled by clicking them in 3D or by expanding the face list and checking its rows; each row
exposes the face area and center on hover or keyboard focus. The neutral plane is an origin plane, a
Datum Plane, an explicit plane, or a planar face of the same part. Each selected face tilts about its
intersection with the neutral plane. Faces that touch a selected face tangentially are drafted with it.

The pull direction follows the plane normal, or points into the part for a planar neutral face. Faces
narrow along the pull direction, so drafting the walls of a box about its base face tapers the box
toward its top. **Flip pull direction** inverts the taper. The angle accepts unit-aware expressions
and `#variables` and must be at least 0.01 degrees and less than 89 degrees. OCCT leaves faces
unchanged at or below 1e-4 rad (about 0.0057 degrees); the 0.01 degree minimum keeps a margin above
that, so tiny angles are rejected rather than silently skipped.

The disposable preview contains one valid solid. Apply replaces the current body of the same authored
part and retains its history; Apply is disabled while the preview evaluates and runs once per click.
Cancel discards the preview. Editing, Undo/Redo, native `.vshape` reopen, and exports use the
ordinary feature lifecycle.

Draft accepts 1–256 faces of one exact solid. Every selected face must be drafted: when OCCT cannot
tilt a face, the preview fails and the task panel names that face's position in the selection. No
face is skipped. Faces tangent to a selected face are drafted with it, so the failure can come from a
tangent neighbour. Blends that run across the pull direction, such as fillets around a top or bottom
face, and faces perpendicular to the pull direction cannot be drafted, so add those fillets after the
draft. Fillets that run along the pull direction, such as rounded vertical corners, are drafted with
their walls.
Faces are stored as body-bound face references; native face indices are never persisted. A face lost
after a source edit requires explicit reselection.

Named local MCP `create_face_draft` and `update_face_draft` use the revision-bound draft command path.
Read face references from `draft_body_topology` or `model_body_topology`, keep a Datum Plane producer
as the second dependency, and preview before commit. The tools are not named `create_draft` because
that name opens an MCP draft session.

The design is recorded in [ADR-0152](../adr/0152-draft-and-uniform-scale-features.md).
