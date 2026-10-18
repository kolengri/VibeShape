# Assembly and local component library

Discover the named tools and their live schemas in the paired local or remote MCP session. Read
`model_info`, then `model_assembly` at its committed revision. Assembly writes have a separate owned
draft; ordinary CAD `create_draft` and its command IDs do not apply to this workflow.

## Author an assembly

1. Call `create_assembly_draft` with the current `baseRevision`. Retain the returned `draftId`, original
   `baseRevision` and private `draftVersion`. Every successful named mutation returns the next version;
   preview retains it. Always use the latest returned tuple. Drafts expire after five minutes of
   inactivity and belong to one paired actor. A document edit requires a fresh draft.
2. Use named definition, instance and joint create/update/remove tools. Obtain source part IDs and body
   roles from `model_parts`, and exact content hashes from `model_body_measurements`. Definitions capture
   frozen source authority inside the controller. Caller-supplied pins, closures, bytes, document
   snapshots, approval flags and file paths are unsupported.
3. Existing assembly v1 retains its strict grounded-forest rules. Explicit `upgrade_assembly` converts
   it to v2 with numeric frame seeds; use v2 for closed loops, multiple mates per occurrence, passive
   drives, cylindrical or ball joints. Every connected component needs a grounded occurrence.
   Instance/joint IDs use UUIDv7. Rigid poses use millimeters and normalized XYZW quaternions; angles
   use radians. Frames preserve orientation and cannot introduce reflection.
4. Run `preview_assembly_draft`. A successful preview is unsaved. Inspect occurrence bounds, local
   degrees of freedom, residual and redundant joint IDs. Passive mobility is valid; it does not prove
   global uniqueness. Conflicting mates, nonconvergence, unsupported budgets and invalid topology fail
   closed. Repair the relevant named records and preview again. Never remove unrelated constraints
   merely to obtain success.
5. Call `commit_assembly_draft` and apply the ordinary browser review. Assembly and library writes
   always require manual Apply, including a session with CAD auto-apply enabled. The exact solver runs
   again after approval before the revision CAS. Edits staged after a review starts cannot share its
   approval. A successful receipt identifies the saved revision and one Undo checkpoint.

Use `discard_assembly_draft` for unwanted proposals. Definition/instance removals expose explicit
`cascade` intent; inspect dependent instances and mates before requesting it.

## Visible motion preview

The Assembly browser lists joints by endpoint and exposes Drive for revolute, prismatic and cylindrical
coordinates. The visible motion panel runs a bounded disposable sweep through the real solver; Apply
saves one solved coordinate and locks that coordinate as a drive. Export and interference use the saved
assembly. These MCP tools do not provide playback. For saved coordinate authoring use the named owned
joint-update, preview and manual-review flow above, with canonical millimeters/radians.

## Select topology frames

Use `inspect_assembly` at the committed revision with an explicit `topology` occurrence/source page.
It returns bounded frozen-source references without meshes or kernel indices. A binding includes that
page's source index, body, pin revision, uniquely resolved reference and analytical geometry recipe,
plus a finite origin hint and X direction. Supported recipes are planar, cylindrical and spherical
faces, circular/arc edges and vertices. Numeric parent/child frames become offsets from the resolved
geometry frame. Mesh occurrences support numeric frames only.

Missing, ambiguous, unsupported or stale topology requires explicit reselection. Relinking increments
the definition pin revision; old bindings do not silently follow the replacement. For exact interference,
request explicit instance pairs through `inspect_assembly`; overlapping meshes report unsupported.

## Reuse the local library

Read `library_items` and `library_version` at the paired committed revision. Version views contain
immutable content identity and metadata, not frozen document closures or raw bytes. Save a current
part/definition with `save_library_definition`; use `expectedMetadataRevision: null` for a new item,
or the current metadata revision for an existing item. Publication requires manual review.
`update_library_metadata` uses the same metadata CAS and does not rewrite immutable versions.

Inside an owned assembly draft, `insert_library_version` requires an explicit immutable version and
`mode: copy` or `reference`, plus definition/instance IDs, names and a grounded pose. Reference mode
retains a pinned library binding; copy mode does not. `relink_library_definition` selects a new version
for an existing reference. `detach_library_definition` removes its binding while retaining frozen
content. Neither operation follows a moving library head automatically. Preview and commit the assembly
through its ordinary review path. Source closure bytes remain repository/controller-owned throughout.

Report saved revision, local mobility and the selected immutable library version. Export an assembly
through the authorized visible editor when requested; these authoring tools do not expose a named
assembly export operation.
