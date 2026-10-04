# ADR-0091: Paired native source imports

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0067](0067-captured-exact-source-imports.md),
  [ADR-0071](0071-explicit-triangle-mesh-source-features.md),
  [ADR-0087](0087-paired-binary-export-chunks.md)

## Decision

Expose five named operations through the existing local and paired remote MCP transports:
`begin_import_upload`, `append_import_chunk`, `inspect_import_upload`, `commit_import_upload`
and `discard_import_upload`. Reuse the editor's source reader, native exact/mesh inspectors,
captured import feature builder and atomic authored transaction. STEP/STP and BREP retain exact
solid representation; STL and 3MF retain explicit triangle meshes. No parser, kernel, file path,
source URL, storage service or generic command authority is added.

One paired actor owns one temporary upload per browser automation handle. Begin captures the
active document and exact base revision, safe leaf filename, declared byte count, source units
and optional feature label. A new upload replaces the previous upload. The browser allocates
the bounded byte buffer and generates the upload identity. Append requires canonical base64,
contiguous offsets and complete chunks except the final chunk. An exact duplicate is idempotent;
conflicting bytes and out-of-order writes fail. New bytes renew a five-minute idle deadline;
duplicates and inspections do not renew it. Expiry, cancel, disposal and document replacement
release the temporary source. Neither transport relay persists source bytes.

Inspect is explicit and requires every declared byte. The existing reader computes SHA-256 from
owned bytes and the native inspector validates the source. The existing import builder captures
output UUIDs and immutable manifest/signatures once. The response exposes normalization, stable
output roles, bounds, triangle counts and surface area. Only exact solids have volume; mesh volume
is null. STEP source units remain caller-supplied metadata, while the STEP reader converts declared
file units; BREP/STL apply their recorded source scale once, and 3MF uses declared units/transforms.
Caller hashes, pins, topology indices, provenance and asset IDs are not accepted.

## Review and atomic publication

Commit requires the inspected upload version and unchanged base. Native inspection runs again
against detached captured bytes before requesting manual browser review. Geometry signatures or
mesh output/normalization changes invalidate the capture. The existing import canvas provides a
read-only preview with explicit representation and bounds. Apply is unavailable until the preview
is ready, prevents duplicate activation and stays pending through persistence. Imports cannot use
the CAD session's auto-apply grant.

The captured browser factory alone receives a closed import commit port. It requires a current
captured document/repository session, an applying review of kind `import`, exact actor, draft/upload
identity, base, upload version, source descriptor, label and canonical transaction commands. Its
private project guard excludes only transport automation-busy while continuing to read every
mounted editor and surface draft blocker. Public project guards and `commitAuthoredTransaction`
remain unchanged. No caller-approved flag, token or exported privileged command path is added.

The ordinary persistent session receives one source-assets/feature transaction with its verified
owned blobs and paired actor on every command. Existing repository CAS, source digest checks,
publication/rollback, Part allocation, portable closure and Undo/Redo apply. An accepted persistence
outcome remains authoritative after transport cancellation; cancellation cannot claim that an
already accepted write did not occur. Source bytes are never published by upload, inspection or
discard, and rejection of the manual review leaves the document unchanged.

## Transport budgets

The MCP upload cap is 6 MiB, below the existing editor/native reader's 32 MiB per-source cap.
Chunks contain at most 90 KiB decoded bytes; their encoded work envelope fits the existing
192 KiB remote message budget. At maximum size, begin, 69 appends, inspection, commit and discard
require 73 operations, below the remote session's 128-operation lifetime. Other calls share that
budget. Clients must pace uploads for the existing 30 operations/minute limit and complete each
idle interval within five minutes. No rate, ordinary response or transport budget is enlarged.
Shared schemas and both adapters correlate upload, requested version, source intent and responses;
the local adapter also checks its captured document identity.

## Verification and limits

Tests cover wire strictness and budgets, actor ownership, offset/retry conflicts, copied buffers,
expiry, stale bases, inspection versions, changed signatures, late native results, rejected review
and accepted persistence after disconnect. Browser acceptance uses authentic STEP/STL/3MF sources,
malformed-source repair, read-only inspection, discard, manual Apply, native Undo/Redo, reload and
portable source closure. Existing native STEP/BREP and mesh parser tests remain the reader evidence.

This decision covers native source import only. SVG/DXF sketch import retains its existing editor
workflow until a separately bounded MCP adapter is implemented. Editable `.vshape` project import,
sources above 6 MiB and filesystem access are outside these tools. Interoperability or physical
manufacturing claims require their own evidence.
