# ADR-0090: Owned SurfaceTexture MCP proposals

- Status: **Accepted**
- Date: 2026-10-04

## Context

[ADR-0059](0059-editable-surface-texture-layers.md) stores editable relief layers in V3/V4 document
authority and derives meshes through the existing geometry worker. The editor supports complete
256 by 256 custom grayscale maps, semantic face targets, ordered brush masks and Undo. MCP must
reach that same command path without receiving a document snapshot, source pin, approval flag or
geometry implementation. CAD auto-apply does not authorize relief or removal proposals.

## Decision

Both transports expose `model_surface_textures`, `create_surface_texture`,
`update_surface_texture` and `remove_surface_texture`. They share strict automation-api schemas,
tool metadata and receipt correlation. Reads require an exact committed revision and feature;
bounded summaries omit custom pixels, complete face references and brush dabs. Mutations require
an exact base revision and stable layer ID. Create supplies a complete recipe and producing feature.
Update patches settings or appends ordered dabs; omitted map, mask and target remain unchanged.
Remove is a separate operation with destructive confirmation.

The wire custom-map format is canonical padded base64 of one unsigned grayscale byte per pixel.
Dimensions are at most 256 by 256, decoded length must equal width times height, and unused padding
bits must be zero. The largest map is 87,384 encoded characters and fits the existing 192 KiB
operation budget. Domain pixels remain integer 0..255, matching the editor's canvas decoder;
normalization belongs to mesh sampling. No image URL, upload route or caller content hash is added.
The existing four-layer feature limit and total 2,048-dab mask limit remain authoritative. Larger
append requests must also fit the ordinary transport budget.

A separate owned coordinator captures the paired actor, document, base revision, server-created
draft/command IDs, immutable draft version, exact command collection and five-minute lifetime.
Its private command schema permits only `textures.replace-layers`. Authority is rechecked after
every asynchronous read, native preview and manual decision. Callbacks receive independent parsed
copies, and the reviewed intent cannot be edited while approval is pending. Cancellation releases
preview workers; an accepted persistence transaction reports its actual outcome after disconnect.

UI and MCP share the application relief helper. It resolves enabled semantic face selections
against the current exact body evidence, joins the resolved candidate to its current worker-owned
`meshFaceId`, rejects missing or ambiguous targets, copies mesh buffers
before transfer and terminates its worker once on success, failure or abort. Enabled proposal targets
must be visible current bodies. Disabled layers may be repaired or removed without applying relief.
The existing GeometryWorkerClient and displacement implementation remain the computational core.
UI face picking uses the inverse join before persisting a semantic reference. Candidate IDs and mesh
face IDs are distinct transient values; neither is stored as texture identity.

Native relief preflight runs before review and again after approval. The manual review displays the
complete resulting collection and renders the proposed relief through the same viewport path;
enabled layers require a ready current viewport preview before Apply. The browser's private commit
port additionally verifies the live applying review, exact actor/base/draft/version/command identity,
expiry, writable session and all editor guards. Only the originating automation-busy condition is
excluded inside that closed composition. Public mutation guards remain unchanged.

The final write uses the ordinary V3 metadata command, V4 authored reducer when applicable, repository
compare-and-swap and Undo entry. V2 adoption is atomic. Native backups retain editable maps, masks and
semantic targets; STL/3MF derive relief while STEP and exact measurements retain the source B-Rep.
No worker protocol or persisted texture schema version changes.

## Consequences

- Local and paired remote MCP use identical names, validation, ownership and manual review.
- Full UI-sized maps can be authored without precision loss or an external upload service.
- Summary reads cannot reconstruct custom maps; updates must preserve omitted owned data.
- Relief changes remain independent of exact assembly geometry and exact CAD topology authority.
- Native success does not establish global self-intersection freedom, wall thickness or physical fit.

## Verification

Schema and coordinator tests cover canonical bytes, padding/length failures, mask limits, omitted
data, actor ownership, stale revisions, cancellation, expiry, callback mutation, narrowed commands
and preflight rejection before/after review. Shared preview tests cover topology resolution, copied
buffers and disposal. Local broker and workerd tests reject mismatched receipts. The paired browser
journey covers full custom maps, exact face scope, mandatory manual review under CAD auto-apply,
append, replay-valid backups, relief export, removal, Undo and reload.

## Alternatives

- Extending the V2 metadata automation union cannot safely represent texture authority or native
  relief evidence. The narrow coordinator preserves its existing contract.
- Numeric pixel arrays increase wire size and leave full-size maps outside the ordinary budget.
- A caller-approved flag or generic authored-command tool would bypass the owned review boundary.
- A new image or displacement service would duplicate the existing local decoder and worker.
