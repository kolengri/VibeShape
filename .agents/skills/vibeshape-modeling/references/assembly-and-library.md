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

## Motion studies and visible playback

The Assembly browser lists joints by endpoint and exposes Drive for revolute, prismatic and cylindrical
coordinates. The visible motion panel runs a bounded disposable sweep through the real solver; Apply
saves one solved coordinate and locks that coordinate as a drive. Seek, reverse, sample count, relative
speed and cancellable loop controls do not imply real-time physics or a promised frame rate. A loop
solves its first cycle and replays the cached solved poses, bounded to 256 poses and 64 MiB of meshes.
Reset, project changes and revision changes discard disposable results. Interference uses the saved
assembly and does not prove that an entire motion is collision-free.

Use `model_assembly` to read saved `motionStudies`. In an owned assembly draft, stage
`create_assembly_motion_study`, `update_assembly_motion_study` or `remove_assembly_motion_study`, then
preview and request ordinary manual Apply. A study has stable UUIDv7 study/track IDs, a duration up to
3600 seconds and 1–64 tracks. Each track selects a stable joint and `angle` (radians) or `translation`
(millimeters), with 2–256 strictly increasing key times inside the duration. The document permits 32
studies and 16384 keys in total. Track coordinates must be unique. Linear interpolation holds the
first/last values outside their key interval. All tracks evaluate simultaneously; cylindrical angle
and translation merge into one joint replacement. Missing joints, changed joint kinds or out-of-limit
keys require repairing/removing tracks in the same transaction. Saving study intent does not apply
its pose or upgrade a legacy assembly.

Read `sample_assembly_motion_study` at the exact committed revision to solve 2–64 samples, optionally
in reverse. Select 1–32 occurrence IDs to bound the response. An optional trace selects one source
index and local point in millimeters; the returned point uses its actual solved geometry frame. Any
solver, limit, cancellation, revision or response-budget failure returns no partial sample result.
Reduce sample/occurrence counts when the 128 KiB response budget is exceeded. Sampling never saves a
pose. Apply a desired pose through ordinary owned joint updates and browser review if requested.

MCP exposes study authoring and exact sampling, not continuous UI playback or image downloads. The
visible study panel exports actual solved JSON/CSV poses and optional point traces, or up to 64 PNG
frames in a ZIP with one fixed camera and a manifest. GIF encoding, contact response, gears/cams and
new mate types are outside this animation contract.

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
