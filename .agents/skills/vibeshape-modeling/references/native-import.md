# Native source import

Use the [model-write approval policy](../../vibeshape-use/references/session.md#model-write-approval)
for the current connection. Manual review instructions below apply to external MCP clients;
library publication remains separately reviewed for every connection.

Use this flow only when the five import tools are advertised and the user authorized importing
the selected source into the paired project. STEP/STP and BREP create exact solids. F3D recovers supported exact bodies and editable records with an explicit conversion report. STL and 3MF
create triangle meshes; they do not acquire BREP faces, edges or solid volume. SVG/DXF planar
drawings use [planar source import](planar-import.md); editable `.vshape` project files use the visible editor workflow.

1. Read the selected source with an authorized file capability, retain its raw bytes and safe leaf
   filename, and reject files above 6 MiB before uploading. An MCP connection does not itself grant
   access to the user's filesystem. Check `model_info` for the current committed revision.
2. Call `begin_import_upload` with `revision`, `filename`, exact `byteLength`, `sourceUnit` and an
   optional label. STEP/STP, BREP and STL require known physical source units. 3MF and F3D require null and
   use their file units. STEP reader conversion follows its file units; the supplied metadata is not
   an additional scale or a measurement of the file units.
3. Retain the returned `uploadId`, `receivedBytes`, `chunkMaxBytes` and expiry. Append canonical
   base64 at `receivedBytes`, using exactly `chunkMaxBytes` decoded bytes except the final chunk.
   Use file tooling to encode bytes, never put base64 into the conversation or substitute a path,
   URL, digest or provenance field. An exact retry is idempotent; a conflicting chunk fails.
4. Call `inspect_import_upload` after all declared bytes have arrived. Compare its computed SHA-256
   and byte count with the local source if available. Inspect representation, normalization, bounds,
   stable output roles, exact volume where present and mesh warnings. For F3D, inspect `f3d.report` and
   `f3d.editableExtrusion`; report unsupported features and unrecovered bodies before committing. Retain the exact `uploadVersion`.
   Upload and inspection have not saved a model. Invalid files fail without partial publication.
5. Call `commit_import_upload` with that upload ID/version. The app reinspects the source and opens a
   manual browser review. The person must inspect the rendered source and choose Apply or Discard;
   no tool approves this review and CAD auto-apply does not cover imports. Wait for the tool's final
   result before reporting a saved revision. One accepted transaction stores source bytes, import
   feature and its ordinary Parts together, with normal CAS and Undo/Redo.
6. Use `discard_import_upload` to release an unused temporary upload. It does not remove saved source
   assets or delete a local file. Beginning either native or planar import replaces the previous temporary source; disconnect, project replacement,
   cancellation and five-minute idle expiry invalidate access. Restart from current revision after a
   stale base or lost session. If an accepted write's transport outcome is unknown, inspect the
   committed document before attempting another import.

Local and paired remote transports expose the same contracts. Remote work messages stay within
192 KiB; a maximum upload uses 69 append calls and 73 calls including begin/inspect/commit/discard,
within the 128-operation session lifetime. Other calls consume the same allowance. Pace calls for
30 operations/minute; new chunks renew the idle deadline, while duplicates/inspection do not.
Larger F3D files require the editor's import route, capped at 64 MiB. Existing other formats retain their own resource policy.

After commit, report the saved revision, feature, representation and relevant dimensions. Browser
save is not an editable backup or an external file delivery. Use the export skill only when requested.

F3D keeps supported XY line/circle sketches editable and numeric user parameters as independent
constants. Fusion expressions, constraints, dimensions and feature links are not preserved. A
single plain circular extrusion is native only after its body measurements match; other recovered
solids are exact-body fallback. Component occurrences and body moves are explicitly unsupported.
The selected F3D upload digest identifies the original archive; persisted source assets contain
recovered millimeter STEP and have their own digest. Original F3D bytes are temporary. No recovered
body means failure; never claim an unsupported record was imported successfully. See
[ADR-0145](https://github.com/kolengri/VibeShape/blob/main/docs/adr/0145-bounded-f3d-source-import.md).
