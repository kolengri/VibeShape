# Session setup and recovery

## Local stdio

Use an already configured server when available. If setup was requested, launch the prepared VibeShape distribution with its documented Bun command and absolute entrypoint; preserve other client servers and credentials. Source setup is documented in the repository's `docs/mcp-quickstart.md` and requires its pinned dependencies and `prepare:local` build. This skill does not require a repository checkout for an existing connection.

List tools and resources. Read `vibeshape://session` for the actual `editorUrl` and `paired` status, then the advertised `vibeshape://authoring-guide` for schemas and examples. Open that exact URL and intended project. Have the person choose **Enable AI session** in the bottom status bar. The default source bridge origin is `http://127.0.0.1:43114`, but the session resource is authoritative; changing host or port changes browser-local storage.

## Remote HTTPS

Get the configured endpoint from the editor's **VibeShape → FAQ and MCP setup… → Connect an AI through MCP**, rather than guessing a hostname. Configure a client supporting Streamable HTTP and OAuth/PKCE. The person opens **Remote AI…** in the bottom status bar, completes the browser challenge, creates a pairing code, enters it on the OAuth consent page, verifies the client and return address in that exact editor tab, and chooses **Allow this client**. Do not solve the challenge, expose the code, or grant consent on their behalf.

Remote exposes the shared named tools except legacy `export_model`, plus the bundled skill catalog as MCP resources and `read_agent_skill`. It omits the local session, authoring-guide, and legacy file-export resources. Bounded geometry export and editable backup transfers are shared; follow [export delivery](../../vibeshape-export/SKILL.md). Skill reads use the same authenticated live-tab authority but never invoke browser work. Use the live tool descriptions and schemas plus the modeling references in this pack. Remote access controls one approved browser tab, not every project or a headless CAD service. A claimed client name is not identity evidence.

Remote uses stateless Streamable HTTP with JSON POST responses. `405 Method Not Allowed` for an authenticated GET to `/mcp` means the optional standalone SSE stream is unavailable; continue through POST rather than restarting OAuth. The consent page accepts one valid **Request tab approval** submission while waiting for approval in the editor. A consumed consent handle requires fresh OAuth authorization.

## Verify and retain the session

After tool discovery and pairing, call `model_info` with `{}`. Check the actual project and `summary.revision`, and retain any measurement diagnostic. A failed invocation is a connectivity/access failure, not an empty model. Distinguish configuration, protocol initialization, tool discovery, pairing, and a successful invocation when reporting setup.

Manual browser Apply is the default. Clicking the status bar's **AI connection and approval mode** opens **Approve each change** and **Apply automatically**. The automatic option opens **Set up auto-apply**, which requires a separate explicit human opt-in for eligible CAD edits in this project/session. No MCP tool enables it. An idle person can choose **Approve each change** to disable auto-apply without ending pairing; already running operations must finish first. Metadata always requires manual review. Do not click approval controls merely to unblock a tool; use the existing grant or have the person review the proposal.

Keep the paired tab open. Local stdio automatically restores the same approved client and project
following transient transport errors, reload, background pauses or bridge restart. The original
browser auto-apply choice is restored only if it was explicitly enabled for that pairing. Recovery
credentials remain tab-scoped and the bridge stores them privately under the current OS user; they
never enter project backups. An active tab renews its one-hour lease; an expired, revoked, changed
client or changed-document grant requires new consent. Stop AI clears recovery authority.

Recovery does not replay interrupted commands, drafts, reviews or exports. After a timeout or
uncertain write, wait for pairing recovery, call `model_info`, and inspect saved revision/records
before deciding whether a fresh proposal is needed. A transaction already accepted by persistence
may finish despite Stop AI. Remote HTTPS retains its existing fresh-pairing rule after reload.

## Working across projects

The shared `list_projects`, `create_project` and `open_project` tools are available over local
stdio and paired remote HTTPS. They require a separate human opt-in: **AI connection and approval
mode → Allow project management**. This grants the paired client access to browser-local project
names and permission to create/open projects in that tab; no MCP tool can enable it. The grant is
not restored after reload or recovery. Stop AI or manual navigation revokes it.

Use the [project workflow](../../vibeshape-organization/SKILL.md) for pagination,
source revision checks, explicit CAD targeting and uncertain outcomes. An authorized tool transition
preserves the transport pairing and replaces document authority without reloading. A different
project discards private drafts/uploads/exports and resets CAD auto-apply; enable that separately in
the destination only when the person wants it. Existing geometry still requires the ordinary
preview/review/commit path.

## Limits and errors

- Serialize operations: one request in flight per paired session. Parallel agents must not write to the same session.
- Drafts expire five minutes after creation or the last successful draft command/preview; inspection does not renew them. An inactive recovery lease lasts at most one hour; an active local tab renews it.
- Current shared serialized operation limit is 192 KiB; semantic pages are bounded to 128 KiB. Reduce page size or divide valid authoring work when necessary. Do not truncate a replacement record.
- Remote additionally limits operations to 30/minute and 128 per tab lifetime, with bounded onboarding attempts. Follow reported rate-limit guidance; do not repeatedly reconnect to evade budgets.
- `busy` requires waiting for the pending request. Stale committed state requires a fresh read/draft. Validation failures require corrected input. A duplicate command ID is an error, not proof of an earlier success.
- A review operation may wait up to six minutes. Keep it pending while the person reviews; client timeout/cancellation interrupts pending work; local access can recover without replay. Do not start a second commit.
- Unknown outcomes require inspection before retrying; a fresh ID does not make a duplicate write safe.
