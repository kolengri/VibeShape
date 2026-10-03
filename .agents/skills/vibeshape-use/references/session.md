# Session setup and recovery

## Local stdio

Use an already configured server when available. If setup was requested, launch the prepared VibeShape distribution with its documented Bun command and absolute entrypoint; preserve other client servers and credentials. Source setup is documented in the repository's `docs/mcp-quickstart.md` and requires its pinned dependencies and `prepare:local` build. This skill does not require a repository checkout for an existing connection.

List tools and resources. Read `vibeshape://session` for the actual `editorUrl` and `paired` status, then the advertised `vibeshape://authoring-guide` for schemas and examples. Open that exact URL and intended project. Have the person open **VibeShape → AI connections…** and choose **Enable AI session**. The default source bridge origin is `http://127.0.0.1:43114`, but the session resource is authoritative; changing host or port changes browser-local storage.

## Remote HTTPS

Get the configured endpoint from the editor's **VibeShape → FAQ and MCP setup… → Connect an AI through MCP**, rather than guessing a hostname. Configure a client supporting Streamable HTTP and OAuth/PKCE. The person opens **VibeShape → AI connections… → Remote AI**, completes the browser challenge, creates a pairing code, enters it on the OAuth consent page, verifies the client and return address in that exact editor tab, and chooses **Allow this client**. Do not solve the challenge, expose the code, or grant consent on their behalf.

Remote exposes the shared named CAD tools except `export_model`, plus the bundled skill catalog as MCP resources and `read_agent_skill`. It has no local session, authoring-guide, or binary export resources. Skill reads use the same authenticated live-tab authority but never invoke browser work. Use the live tool descriptions and schemas plus the modeling references in this pack. Remote access controls one approved browser tab, not every project or a headless CAD service. A claimed client name is not identity evidence.

Remote uses stateless Streamable HTTP with JSON POST responses. `405 Method Not Allowed` for an authenticated GET to `/mcp` means the optional standalone SSE stream is unavailable; continue through POST rather than restarting OAuth. The consent page accepts one valid **Request tab approval** submission while waiting for approval in the editor. A consumed consent handle requires fresh OAuth authorization.

## Verify and retain the session

After tool discovery and pairing, call `model_info` with `{}`. Check the actual project and `summary.revision`, and retain any measurement diagnostic. A failed invocation is a connectivity/access failure, not an empty model. Distinguish configuration, protocol initialization, tool discovery, pairing, and a successful invocation when reporting setup.

Manual browser Apply is the default. **Set up auto-apply** requires a separate explicit human opt-in for eligible CAD edits in this project/session. No MCP tool enables it. Metadata always requires manual review. Do not click approval controls merely to unblock a tool; use the existing grant or have the person review the proposal.

Keep the paired tab open. Local stdio restores access after reload in the same tab and project within 60 seconds while the original session remains valid. Wait for recovery, then call `model_info` and inspect the current revision; interrupted requests and drafts are never replayed. Remote HTTPS still requires fresh pairing and client consent after reload. Project changes, Stop AI, other disconnects, cancellation, and session expiry require pairing again; auto-apply does not carry over. **Stop AI** revokes access, but a save that already entered persistence may finish. After an uncertain write, restore pairing and inspect the saved revision and affected records before deciding whether more work is needed.

## Limits and errors

- Serialize operations: one request in flight per paired session. Parallel agents must not write to the same session.
- Drafts expire five minutes after creation or the last successful draft command/preview; inspection does not renew them. Pairing lasts at most one hour.
- Current shared serialized operation limit is 192 KiB; semantic pages are bounded to 128 KiB. Reduce page size or divide valid authoring work when necessary. Do not truncate a replacement record.
- Remote additionally limits operations to 30/minute and 128 per tab lifetime, with bounded onboarding attempts. Follow reported rate-limit guidance; do not repeatedly reconnect to evade budgets.
- `busy` requires waiting for the pending request. Stale committed state requires a fresh read/draft. Validation failures require corrected input. A duplicate command ID is an error, not proof of an earlier success.
- A review operation may wait up to six minutes. Keep it pending while the person reviews; client timeout/cancellation can revoke pairing. Do not start a second commit.
- Unknown outcomes require inspection before retrying; a fresh ID does not make a duplicate write safe.
