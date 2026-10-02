# Local MCP quickstart

VibeShape is a browser CAD editor with an opt-in local stdio MCP bridge. External agents use
named tools; the browser remains the document owner and the person approves each draft commit.
There is no embedded chat. The bridge serves the production editor at a stable loopback origin;
use the same origin to retain browser-local projects.

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

Open the returned editor URL, open or create the intended project, and click **Enable AI session**.
Read `model_info`, create a draft at its committed revision, issue supported named commands,
preview exact geometry, and request `commit_draft`. Click Apply in the browser review. Then read
the new revision and export STEP/STL/3MF. The export response contains a resource link; read it,
decode the returned base64 blob and save it with the client's file tools. Ordinary saved state,
manual editing and Undo use the same document session.

For an agent editing a person's existing model, reread the current full feature/sketch/variable
records and preserve their IDs and unaffected intent. If manual work changes the base revision,
create a fresh draft from the updated model. Cancellation revokes pairing; a commit that already
entered persistence cannot be rolled back by disconnect. Inspect the actual saved revision before
retrying an interrupted or unconfirmed commit.

The current MCP surface is a supported subset of the editor, not full CAD parity. In particular,
Box update/placement and Cylinder/Boolean/Datum Plane/removal/history tools are not exposed.
There is no arbitrary script or direct storage tool. Production printability analysis remains open.
See the served guide for the complete current scope and
[automation architecture](architecture/automation-and-mcp.md) for the authority and safety contract.

The prepared local build publishes its runtime provenance at `/local-build.json` and its
source/license index at `/sources/index.html` on the same editor origin. Retain those delivery
files with the editor.

A production distribution must also meet the repository's controlled geometry runtime, source
and license delivery, browser/recovery, offline and update gates. A local source launch by itself
is not evidence that those release gates passed.
