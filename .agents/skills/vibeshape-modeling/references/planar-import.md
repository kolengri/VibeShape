# Planar source import

Use the [model-write approval policy](../../vibeshape-use/references/session.md#model-write-approval)
for the current connection. Manual review instructions below apply to external MCP clients;
library publication remains separately reviewed for every connection.

Use this flow when the five planar import tools are advertised and the user authorized importing
selected SVG/DXF source bytes into the paired project. The result is an ordinary editable Sketch
with exact supported curves and captured source provenance. Import creates no Part. Native
STEP/STP/BREP/STL/3MF files use [native source import](native-import.md).

1. Read the authorized source with a file capability and retain raw bytes and a safe leaf filename.
   Reject files above 6 MiB before uploading. An MCP connection grants no filesystem access.
   Read `model_info` for the exact committed revision.
2. Begin with `begin_planar_import_upload`: revision, filename, byteLength, unit, plane and optional
   label. SVG requires `mm`, `cm`, `m`, `in`, `ft`, `um` or `px` (96 dpi). DXF accepts `declared`
   or a physical override; declared unitless input fails. Select `xy`, `xz` or `yz`. Embedded
   supported SVG/DXF transforms are preserved by the existing parser; custom matrices are not inputs.
3. Append canonical base64 with `append_planar_import_chunk` at returned receivedBytes, exactly
   chunkMaxBytes decoded bytes except the final chunk. Use file tooling to encode bytes, never
   put base64 in conversation or substitute a path, URL, hash or provenance field. Exact duplicate
   chunks are idempotent; conflicting or out-of-order chunks fail.
4. Inspect with `inspect_planar_import_upload` after all bytes arrive. Compare computed SHA-256
   and byteLength with the local source if available. Inspect normalization, unit policy, plane,
   bounds, curve/path counts and captured sketch/path IDs. Keep exact uploadVersion. Unsupported
   elements, external references, nonplanar or over-budget geometry fail without partial imports,
   sampled flattening or source text conversion. Inspection does not save a Sketch.
5. Commit that upload ID/version with `commit_planar_import_upload`. The app reparses the owned
   bytes and opens manual analytical curve review. The person chooses Apply or Discard; no tool
   approves it and CAD auto-apply does not cover imports. Wait for the final result before reporting
   a saved revision. Apply atomically stores verified source assets and one editable Sketch with
   paired actor provenance, ordinary CAS, Undo/Redo and portable source closure.
6. Discover the saved Sketch and read `model_sketch_solution` for exact solved profile selectors
   at the returned revision. Use those selectors in an ordinary downstream feature draft; profile
   selectors can change after editing imported geometry. Ordinary point edits retain the captured
   source binding; removal of captured identities detaches it under the existing Sketch rules.
7. Discard unused bytes with `discard_planar_import_upload`. Beginning either native or planar import
   releases the previous temporary source. Disconnect, project replacement, cancellation and
   five-minute idle expiry invalidate it. Restart from the current revision after a stale base.
   An unknown transport outcome after Apply requires committed inspection before retrying.

Local and paired remote contracts match. The existing 192 KiB message budget and 128-operation
session lifetime remain unchanged. A maximum source needs 69 appends and 73 calls including
begin/inspect/commit/discard; other calls share this allowance. Pace calls for 30 operations/minute.
New chunks renew idle expiry; retries and inspection do not. Larger sources use the existing
editor Import sketch route with its separate 32 MiB cap. A saved Sketch is not an external file
delivery; export only when requested.
