# Native source import

Use this flow only when the five import tools are advertised and the user authorized importing
the selected source into the paired project. STEP/STP and BREP create exact solids. STL and 3MF
create triangle meshes; they do not acquire BREP faces, edges or solid volume. SVG/DXF planar
drawings and editable `.vshape` project files use their separate visible editor workflows.

1. Read the selected source with an authorized file capability, retain its raw bytes and safe leaf
   filename, and reject files above 6 MiB before uploading. An MCP connection does not itself grant
   access to the user's filesystem. Check `model_info` for the current committed revision.
2. Call `begin_import_upload` with `revision`, `filename`, exact `byteLength`, `sourceUnit` and an
   optional label. STEP/STP, BREP and STL require known physical source units. 3MF requires null and
   uses declared units. STEP reader conversion follows its file units; the supplied metadata is not
   an additional scale or a measurement of the file units.
3. Retain the returned `uploadId`, `receivedBytes`, `chunkMaxBytes` and expiry. Append canonical
   base64 at `receivedBytes`, using exactly `chunkMaxBytes` decoded bytes except the final chunk.
   Use file tooling to encode bytes, never put base64 into the conversation or substitute a path,
   URL, digest or provenance field. An exact retry is idempotent; a conflicting chunk fails.
4. Call `inspect_import_upload` after all declared bytes have arrived. Compare its computed SHA-256
   and byte count with the local source if available. Inspect representation, normalization, bounds,
   stable output roles, exact volume where present and mesh warnings. Retain the exact `uploadVersion`.
   Upload and inspection have not saved a model. Invalid files fail without partial publication.
5. Call `commit_import_upload` with that upload ID/version. The app reinspects the source and opens a
   manual browser review. The person must inspect the rendered source and choose Apply or Discard;
   no tool approves this review and CAD auto-apply does not cover imports. Wait for the tool's final
   result before reporting a saved revision. One accepted transaction stores source bytes, import
   feature and its ordinary Parts together, with normal CAS and Undo/Redo.
6. Use `discard_import_upload` to release an unused temporary upload. It does not remove saved source
   assets or delete a local file. Begin replaces the previous upload; disconnect, project replacement,
   cancellation and five-minute idle expiry invalidate access. Restart from current revision after a
   stale base or lost session. If an accepted write's transport outcome is unknown, inspect the
   committed document before attempting another import.

Local and paired remote transports expose the same contracts. Remote work messages stay within
192 KiB; a maximum upload uses 69 append calls and 73 calls including begin/inspect/commit/discard,
within the 128-operation session lifetime. Other calls consume the same allowance. Pace calls for
30 operations/minute; new chunks renew the idle deadline, while duplicates/inspection do not.
Larger files require the editor's existing import route, which has a separate 32 MiB cap.

After commit, report the saved revision, feature, representation and relevant dimensions. Browser
save is not an editable backup or an external file delivery. Use the export skill only when requested.
