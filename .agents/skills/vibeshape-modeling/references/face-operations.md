# Face operations

Read after the body-operation rules in [modeling contracts and recipes](modeling.md). Select the exact
feature/output-role pair with `model_body_measurements` or `draft_body_measurements`, read face
references from `draft_body_topology` or `model_body_topology`, never persist native indices, and
preview before commit.

`create_face_draft`/`update_face_draft` taper 1–256 faces of one exact named body; `create_draft` is the unrelated draft-session tool. Read body-bound face references from `draft_body_topology` or `model_body_topology` for the target role, choose `neutralPlane` (origin-plane, datum-plane, explicit-plane, or a planar-face of the same body that is not itself drafted), a typed angle quantity of at least 0.01 and less than 89 degrees (use a `#draft_angle` variable for editable intent), and `flip`. Dependencies are the target first plus any distinct Datum Plane producer; generic references stay empty. The pull direction is the plane normal, or into the body for a planar neutral face; faces narrow along it and `flip: true` inverts the taper. Tangent-connected faces follow a selected face, so a failure can come from a tangent neighbour; fillets that run across the pull direction (around a top face) cannot be drafted, so add them after the draft, while fillets along the pull direction are drafted with their walls. A face OCCT cannot draft fails preview with its 1-based selection index; reselect faces instead of removing them silently. For modifying Extrude targets, omit inferred `semanticRole` values from face references.

`create_thicken`/`update_thicken` build a uniform-thickness solid from 1–256 connected faces of one exact body (face references from `draft_body_topology`/`model_body_topology`). `thickness` is a length from 0.001 to 10,000 mm (prefer a variable such as `#wall`); `side` is `outward` (outward face normals), `inward` or `symmetric`. `operation: "new"` keeps the source and adds a body under the Thicken `result` role; `add`/`remove` fuse or cut the region and replace the source part, and fail when that changes nothing. Supply the sole matching dependency and empty references. The faces must keep a free boundary edge: a whole sphere or torus, every face of a body or an internal void is rejected (use Shell). On a curved face the offset must stay below the concave-side curvature radius. Sharp-edged selections extend their offsets to meet, and their free walls follow the neighbouring body faces. Failures name the 1-based face; nothing is skipped.

`create_press_pull`/`update_press_pull` (see Body operations below); do not substitute
extrusion-distance editing for direct face editing. Existing MCP geometry/history edits
preserve V6 part appearance by authored PartId, and native backups retain it. Appearance presets are
visual metadata, not structural material or density assignments. Inspect the live schemas before
claiming a new transport capability.

`create_scale`/`update_scale` scale one exact named body uniformly: a unitless scalar `factor` from 0.001 to 1000 (expressions allowed), and `center` of `{kind:"bounding-box-center"}`, `{kind:"origin"}`, or `{kind:"point", point:{x,y,z}}` with length quantities. Supply the sole matching dependency and empty references. Volume changes by factor cubed; preview bounds to confirm the fixed center. Non-uniform scale is not available. Scale results carry no durable face identities, so after a factor change re-inspect topology and reselect every dependent face. Prefer authoring correct dimensions and variables over adding Scale to fix a sizing mistake.
