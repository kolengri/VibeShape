# ADR-0087: Paired binary export chunks and editable backups

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0043](0043-local-stdio-mcp-browser-session.md),
  [ADR-0058](0058-remote-mcp-paired-browser-transport.md)

## Decision

Expose four named tools through both existing MCP transports: `prepare_model_export`,
`prepare_project_backup`, `read_export_chunk` and `discard_export`. Geometry preparation reuses
the active document's native STEP/STL/3MF export. Backup preparation reuses portable `.vshape`
closure and its versioned archive writer, including authored history and referenced source bytes.
No new kernel, storage service, file path or direct filesystem mutation is introduced.

Preparation requires the exact committed revision. The browser checks document identity, active
session and revision before and after asynchronous export and hashing. The backup path captures
the paired document privately rather than invoking a UI action guard that rejects its own
transport's busy state. The public project-file guard remains unchanged. This path is read-only;
it does not bypass document commit review, persistence or Undo.

One detached immutable file is retained per browser automation handle and exact MCP actor. A new
preparation evicts the previous file. The descriptor includes document/revision, format, fixed
filename, MIME type, byte count, SHA-256 and five-minute expiry. Reads do not renew expiry. Later
document edits do not change already prepared bytes; disconnect, project replacement, explicit
cancel, disposal and expiry remove access. Cancellation drops late results but does not claim to
interrupt the active document's shared native worker.

## Transport budgets

The file limit is 6 MiB, matching the existing local export budget. A chunk contains at most
90 KiB decoded bytes, keeping its base64 representation and browser envelope within the existing
192 KiB remote message limit. MCP duplicates the result in text and structured content; its
existing 512 KiB serialized response limit still applies. At maximum size, one preparation,
69 reads and one discard fit within the remote session's 128-operation lifetime budget. Existing
rate limits still require pacing, and other operations consume the same session allowance.

Offsets, byte counts, final offsets and actual base64 lengths are checked by shared strict schemas.
Both adapters correlate export identity, requested offset/length, revision and format; the local
adapter additionally checks its captured document identity. Browser ownership remains authoritative
for both transports. The relay does not retain or persist file bytes.

The client reconstructs chunks with its ordinary file tools, verifies byte length and SHA-256,
then saves bytes at the requested destination. Base64 must not be printed into the conversation
or saved as file content. A descriptor is not a delivered file. Larger files and explicit part
selection retain the editor's ordinary export/download workflow. The legacy local `export_model`
resource workflow remains available and remains excluded remotely.

## Acceptance

Tests cover actor isolation, exact source provenance, detached byte ownership, revision changes,
late cancellation/hash results, expiry without renewal, eviction, offsets, idempotent discard,
wire budgets and shared local/remote discovery. Real stdio MCP acceptance retrieves native
STEP/STL/3MF and a replay-validated `.vshape`, verifies its digest, opens the backup in fresh browser
storage and confirms persisted editable feature identity after reload. This is local transport
and archive evidence, not a deployed remote endpoint receipt or physical print validation.
