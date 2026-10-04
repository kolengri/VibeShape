# Local MCP quickstart

VibeShape is a browser CAD editor with an opt-in local stdio MCP bridge. External agents use
named tools; the browser remains the document owner and manual approval is the default.
There is no embedded chat. The bridge serves the production editor at a stable loopback origin;
use the same origin to retain browser-local projects.

Named tools cover all registered Box, Cylinder, Cone, Sphere, Torus and Pyramid authoring, plus
owned-draft feature/sketch removal, explicit suppression and project rename. Lifecycle changes
always require browser review and retain dependency-blocked diagnostics; see the
[modeling contracts](../.agents/skills/vibeshape-modeling/references/modeling.md#feature-and-sketch-lifecycle).

Read `vibeshape://agent-skills` for the bundled [application-use skill pack](agent-skills.md), then load the entrypoint and relevant modeling, inspection, organization, export, or recovery documents. Clients exposing only tools can call `read_agent_skill` with no arguments for the index and a listed `uri` for a document. Local installation of the pack is optional.

From the repository, install the pinned Bun workspace dependencies and build the editor using
`bun ci` and `bun run prepare:local`. Configure a stdio MCP client to launch Bun with the absolute path
to `apps/mcp-server/src/index.ts` as its argument. For example:

```json
{
  "mcpServers": {
    "vibeshape": {
      "command": "bun",
      "args": ["/absolute/path/to/VibeShape/apps/mcp-server/src/index.ts"]
    }
  }
}
```

The default editor origin is `http://127.0.0.1:43114`. An explicit `--port 43115` may be appended
to the arguments when needed; changing the port changes browser storage origin. A busy selected
port causes startup failure. The process writes protocol JSON to stdout and startup diagnostics
to stderr. It does not require a hosted deployment or an external API account.

After MCP initialization, list resources and tools. Read `vibeshape://session` to get the actual
`editorUrl` and `paired` status, even before opening a browser. Read `vibeshape://authoring-guide`
for the canonical agent workflow, exact quantity shapes, portable UUIDv7 generation, supported
scope, limits, and complete schema-backed printing plate example. The guide is served directly
by the adapter from [authoring-guide.ts](../apps/mcp-server/src/authoring-guide.ts); it is available
without document access. The session resource exposes no token or document identity.

Open the returned editor URL, open or create the intended project, then choose
**VibeShape → AI connections… → Enable AI session**.
Read `model_info`, create a draft at its committed revision, issue supported named commands,
preview exact geometry, and request `commit_draft`. Click Apply in the browser review. Then read
the new revision and export STEP/STL/3MF. The export response contains a resource link; read it,
decode the returned base64 blob and save it with the client's file tools. Ordinary saved state,
manual editing and Undo use the same document session.

For this project and paired session only, **Set up auto-apply** offers an explicit opt-in for valid
CAD creation and parameter edits. The visible **Auto-apply on** indicator always includes **Stop AI**,
which ends the pairing immediately. Destructive or unsupported drafts still require review; an
already pending review cannot be auto-approved. Invalid geometry and stale revisions are rejected.
The grant resets on disconnect, project change, and reload. Local MCP restores the same project
after a reload in the same tab within 60 seconds, without extending the original session expiry.
Stop AI prevents recovery. Interrupted commands and drafts are never replayed; call `model_info`
and inspect the saved revision before continuing. Opt in to auto-apply again if desired.
See [ADR-0075](adr/0075-local-mcp-tab-reload-recovery.md) for recovery boundaries. An edit already saving may finish after Stop; inspect the result and use Undo if needed.

`model_parts`, `model_folders`, and `model_history` provide bounded, exact-revision views of authored metadata and canonical History order. `change_metadata` proposes one typed part/folder change through exact preview and browser Apply/Discard. Metadata proposals always require manual review, including when CAD auto-apply is on. The accepted command keeps the paired agent actor and supplied command identity in the native history. Reuse neither a stale revision nor an already committed command ID.

For an agent editing a person's existing model, reread the current full feature/sketch/variable
records and preserve their IDs and unaffected intent. If manual work changes the base revision,
create a fresh draft from the updated model. Cancellation revokes pairing; a commit that already
entered persistence cannot be rolled back by disconnect. Inspect the actual saved revision before
retrying an interrupted or unconfirmed commit.

Both local and paired remote MCP expose `create_datum_plane`/`update_datum_plane`,
`create_boolean`/`update_boolean`, `create_union`/`update_union`, and
`create_compound`/`update_compound`. Datum Planes retain explicit origin/face support and signed
offset intent. Boolean subtraction retains legacy whole-result target/tool semantics; Union and
Compound select ordered exact bodies through schema v2. Read the
[modeling contract](../.agents/skills/vibeshape-modeling/references/modeling.md#datum-plane-and-body-combinations)
before selecting inputs. An explicit session auto-apply grant covers Union v2 and Loft v1/v2/v3 creation
and same-version edits; Compound and version-upgrade edits still require review.

The current MCP surface is a supported subset of the editor, not full CAD parity. Placement and
History mutation tools are not exposed. Registered primitives and lifecycle commands follow the
typed draft contracts above.
The AI can inspect their saved records and must preserve them during supported upstream edits.
There is no arbitrary script or direct storage tool. Production printability analysis remains open.
See the served guide for the complete current scope and
[automation architecture](architecture/automation-and-mcp.md) for the authority and safety contract.

The prepared local build publishes its runtime provenance at `/local-build.json` and its
source/license index at `/sources/index.html` on the same editor origin. Retain those delivery
files with the editor.

After replacing the prepared build, restart the local MCP process before reloading its editor.
The static server retains its startup HTML; serving it with newly replaced asset files can produce
a blank page from missing old asset URLs.

A production distribution must also meet the repository's controlled geometry runtime, source
and license delivery, browser/recovery, offline and update gates. A local source launch by itself
is not evidence that those release gates passed.

Solved sketches can be inspected with `model_sketch_solution` and `draft_sketch_solution`.
Use the exact revision and sketch ID; choose points, circles, failed constraints, profiles or
diagnostics. Each bounded page includes native solver status and DOF. Usable profile pages
provide stable selectors for sketch-backed feature tools. Start with a null cursor and restart
after an edit or expired inspection; cursors cannot cross sections. Reads do not save the sketch.

## Native source import

Both paired transports expose `begin_import_upload`, `append_import_chunk`, `inspect_import_upload`,
`commit_import_upload` and `discard_import_upload`. Native STEP/STP/BREP/STL/3MF files use one
actor-owned upload, a computed SHA-256 and captured output roles, followed by explicit native
inspection and manual browser review. Apply publishes source bytes, feature and Parts through
one ordinary atomic CAS transaction; upload/inspection/discard never save geometry. Meshes retain
triangle representation and have no exact volume.

MCP sources are limited to 6 MiB and 90 KiB decoded chunks. The maximum transfer needs 69 appends
and 73 total operations including begin/inspect/commit/discard, within the existing remote
128-operation lifetime. Pace calls for 30 operations/minute and the five-minute idle expiry.
The 192 KiB remote work budget is unchanged. Known units are required for STEP/BREP/STL; 3MF uses
its declared units. Paths, URLs, caller hashes, pins and provenance are not accepted. See
[ADR-0091](adr/0091-paired-native-source-imports.md) and the bundled modeling native-import workflow.
SVG/DXF sketch import uses the distinct planar source tools described below. Editable `.vshape` project import remains an editor workflow.

## Planar source import

The paired transports also advertise `begin_planar_import_upload`, `append_planar_import_chunk`,
`inspect_planar_import_upload`, `commit_planar_import_upload` and `discard_planar_import_upload`.
They reuse the same 6 MiB/90 KiB transfer bounds and existing SVG/DXF parser, exact transform
preparation, editable Sketch builder and atomic source-assets transaction. SVG requires explicit
physical units or `px` at 96 dpi. DXF accepts declared file units or a physical override. Choose
`xy`, `xz` or `yz` before uploading. No caller transforms, hashes or authorizing flags are accepted.

Inspection computes SHA-256 and captures sketch/path identities, normalization, 2D bounds and
counts without saving a model. Commit reparses the source and opens manual analytical curve
review. Apply creates an ordinary editable Sketch with source provenance, without a Part;
rediscover solved profiles before adding an ordinary downstream feature. Unsupported geometry
fails without flattening or partial import. Beginning either import kind releases the other
temporary source. See [ADR-0092](adr/0092-paired-planar-source-imports.md) and the bundled planar-import workflow.

Assembly and local-library tools use the same paired authority on local and remote MCP. Read the
[assembly/library workflow](../.agents/skills/vibeshape-modeling/references/assembly-and-library.md)
for private draft versions, topology frames, immutable component versions and mandatory manual Apply.
Assembly previews are unsaved; callers cannot provide frozen pins or source bytes.

Exact-body modifying operations are additive: `create_body_revolve`/`update_body_revolve` author
Revolve v7 Add/Remove/Intersect on a stable target role; `create_body_subtract`/`update_body_subtract`
author Subtract v2 with ordered exact target/tool roles, including distinct bodies of one producer.
Legacy names preserve their contracts. See the [modeling contracts](../.agents/skills/vibeshape-modeling/references/modeling.md)
for dependency ordering, tool retention, preview, and ordinary review/Apply.
