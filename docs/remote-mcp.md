# Remote MCP operation and limits

The remote adapter connects a standard HTTPS MCP client to the exact browser tab its owner approves.
It reuses existing CAD, sketch, variable, topology and metadata tools. The editor owns geometry,
documents, review, persistence and Undo. The local Bun/stdio workflow remains available separately.
The shared `model_history_state`, `undo_model` and `redo_model` tools use explicit current document/revision context and always require manual browser history review, including auto-apply sessions. Historical snapshots stay private; Apply uses the ordinary restore CAS and publishes one new revision. Read the [organization workflow](../.agents/skills/vibeshape-organization/SKILL.md#saved-change-undo-and-redo) for availability, expiry and recovery.
See [ADR-0058](adr/0058-remote-mcp-paired-browser-transport.md).

`render_preview` is available on both transports. Request an exact saved model or owned CAD draft
revision to receive a native PNG image and metadata. The default isometric/front/right/top collage
does not alter the user's viewport. Forward image tool content to a vision-capable model; structured
metadata alone cannot establish appearance. Read [visual inspection](../.agents/skills/vibeshape-inspection/SKILL.md#visual-inspection)
for exact body targeting, focused views, representation limits and complementary numeric checks.

The shared tool catalog includes `create_datum_plane`/`update_datum_plane`,
`create_boolean`/`update_boolean`, `create_union`/`update_union`, and
`create_compound`/`update_compound`. Plane support/offset, legacy whole-result subtraction and v2
exact-body selections follow the same [modeling contracts](../.agents/skills/vibeshape-modeling/references/modeling.md#datum-plane-and-body-combinations)
and owner-bound revisioned drafts as local stdio. An explicit browser session auto-apply grant
covers Union v2 and Loft v1/v2/v3 creation and same-version edits; Compound and schema upgrades require
manual review. Tools cannot enable the grant.

The shared catalog also exposes `draft_body_measurements` and `draft_body_topology`. They evaluate
owned unsaved geometry at the exact current draft revision, allowing selection of Shell opening
faces before one final Apply. Reads retain bounded cursor and body scope, do not save or renew
expiry, and require fresh discovery after source edits. Mirror accepts legacy plane-only v1 inputs
or explicit v2 `offset` and `preserveSource` parameters for a shifted plane and an independent
reflected copy. See the [body-operation contracts](../.agents/skills/vibeshape-modeling/references/modeling.md#body-operations-and-section-features).

`model_info.diagnostics` and `preview_draft.geometry.diagnostics` expose feature failures, blocked
dependencies and sketch/datum/external-reference health with affected entity IDs and repair actions.
Valid solid measurements do not imply valid support references; inspect diagnostic status separately.

The server bundles the [application-use skill pack](agent-skills.md), including modeling, recovery and the browser export fallback. After authentication, read `vibeshape://agent-skills`, then the entrypoint and relevant document URIs. Clients exposing only tools can use `read_agent_skill`. Both routes retain live-tab OAuth checks, return static instructions only, and never dispatch browser work. No checkout or local skill installation is required.

## Project management

Both local stdio and paired remote HTTPS expose `list_projects`, `create_project` and `open_project`.
The browser owner first enables **AI connection and approval mode → Allow project management**.
The separate live grant allows catalog access and create/open; it is never enabled through MCP or
restored after recovery. Stop AI and manual project navigation revoke it.

`list_projects` returns `activeProjectId`, a bounded page and `nextCursor` (null at the end).
`limit` defaults to 50 and is capped at 100; use the returned cursor for the next page. Create/open
require `expectedProjectId` and `expectedRevision` from a fresh `model_info`. Create takes a normalized
`name` and opens the empty project; open takes the exact destination `projectId`. Both return
`{ projectId, name, revision }`. The editor must be saved and idle with no editor draft or pending review.

Authorized transitions preserve the transport and replace document authority without reloading.
Different-project transitions dispose private drafts/uploads/exports and reset CAD auto-apply.
Same-project open is a no-op. CAD tools accept an optional `projectId` guard and reject a different
active project before dispatching. Read `model_info` and start a new draft after switching. If an
outcome is uncertain, inspect the active project and catalog before retrying a creation.

See [ADR-0096](adr/0096-mcp-project-management.md) and the
[operator project workflow](../.agents/skills/vibeshape-organization/SKILL.md#browser-local-projects).

## User workflow

Open **VibeShape → FAQ and MCP setup… → Connect an AI through MCP** in the editor for the deployed URL, pairing steps and a
copyable AI setup prompt. Builds without a configured relay show an unavailable message instead of
advertising a connection. The other FAQ pages cover editable backups, export and reconnection.

Configure the MCP client with the deployed HTTPS `/mcp` URL. Open the hosted editor, choose
**VibeShape → AI connections… → Remote AI**, complete its browser challenge and create a pairing code. During OAuth authorization,
enter the code on the service's consent page. Return to that exact editor tab, verify the client and
return address and choose **Allow this client**. A claimed client name is not proof of identity.
**Request tab approval** locks after one valid submission and shows a pending status while the
editor approval is outstanding. Returning to the form after a failed navigation resets its controls;
the SDK's browser-bound consent handle remains one-use, so a consumed handle requires fresh OAuth authorization.

Manual Apply is the default. **Set up auto-apply** is a separate browser opt-in for eligible CAD
commands only, governed by [ADR-0052](adr/0052-session-cad-auto-apply.md). Metadata still requires
manual review. **Stop AI** immediately disposes browser authority before a network acknowledgement.
Reload, disconnect, manual project navigation or connection failures require a new pairing and fresh opt-in. Authorized project tools preserve the pairing; switching projects resets auto-apply.
If a connection ends during Apply, inspect the current revision; a save already accepted by ordinary
persistence may finish. Requests with uncertain outcomes are never automatically retried.

Use `prepare_model_export` for exact committed STEP/STL/3MF or `prepare_project_backup` for an
editable `.vshape`, then `read_export_chunk` and `discard_export`. Both transports expose these
actor-owned transfers with a 6 MiB file limit, 90 KiB decoded chunks and five-minute expiry.
Reconstruct bytes outside the conversation and verify the descriptor's byte count and SHA-256.
Preparation evicts the prior file; reads do not renew expiry. Respect the shared remote rate and
128-operation lifetime budgets. See [the export workflow](../.agents/skills/vibeshape-export/SKILL.md)
and [ADR-0087](adr/0087-paired-binary-export-chunks.md). Legacy `export_model` and its local resources
remain excluded remotely. Larger files and explicit part exports use the editor's ordinary dialog.

## Required deployment configuration

The checked-in Worker configuration targets the personal Greg account and its dedicated OAuth KV
namespace and Turnstile widget. Server-side Turnstile verification requires the separately provisioned
Worker secret. Configuration alone is not proof that a remote endpoint is deployed or connected.

| Setting or binding | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact HTTPS Worker origin, without a trailing slash |
| `EDITOR_ORIGIN` | Exact HTTPS hosted editor origin, without a trailing slash |
| `TURNSTILE_SITE_KEY` | Public key for a free widget restricted to the editor hostname |
| `TURNSTILE_SECRET_KEY` | Worker secret for server-side verification; never a repository/build variable |
| `OAUTH_KV` | Dedicated Workers KV namespace used only by the official OAuth provider |
| `ADMISSION` | Fixed SQLite Durable Object that serializes onboarding budgets |
| `TAB_SESSIONS` | SQLite Durable Object namespace with one admitted object per editor tab |
| `IP_LIMIT` | Workers Rate Limiting binding, initially 60 requests/minute per IP/location |
| `VITE_REMOTE_MCP_URL` | Public HTTPS `/mcp` endpoint embedded in the editor build |

For the personal deployment, the editor origin is
`https://vibeshape-greg.pages.dev`, and the endpoint implied by the checked-in Worker name is
`https://vibeshape-remote-mcp.greg-ddd.workers.dev/mcp`. These are intended configuration values,
not live remote verification receipts. The Greg dashboard showed Workers Free during provisioning;
the owner must recheck the plan before later deployments or changes in admission limits.

Keep secrets in Cloudflare's secret store. Do not put a browser credential, OAuth token, Turnstile
secret or deployment credential in a URL, local/session storage, `.dev.vars`, project file, log or
checked-in configuration. The browser credential exists only in memory and is sent in a WebSocket
authentication message or an Authorization header. OAuth authorization codes use the standard
registered callback flow; they are not bearer credentials.

Worker deployment requires Workers Scripts Write plus the resource-specific authority to provision
its SQLite Durable Objects, Workers KV namespace and Turnstile widget. The existing Pages-only CI
token does not grant these rights. The coarse rate-limit binding uses a stable project namespace
(`1598340211`); confirm that no other Worker in the target account uses it before provisioning. Prepare a separately scoped, owner-approved deployment credential
only if Worker CI is explicitly authorized. Resource provisioning, credential creation and paid-plan
changes are external operations; local implementation does not authorize them.

The editor CSP must allow the exact relay HTTPS and WSS origins in `connect-src`, and
`https://challenges.cloudflare.com` in `script-src` and `frame-src`. Keep these additions scoped to
editor HTML and derive them from a validated endpoint. Do not allow arbitrary `workers.dev` hosts.
The Worker consent page has a separate restrictive CSP and renders no executable client content.
After approval, a non-cacheable completion page starts a fresh navigation to the SDK-validated
callback and provides a fallback link. This preserves `form-action 'self'` without blocking
Chromium's return to an HTTPS or IPv4/IPv6 loopback client, or interpolating client origins into CSP.
The consent form uses `Referrer-Policy: same-origin` so its POST retains the required same-origin
`Origin` header; completion and other OAuth responses retain `no-referrer`.
Only the consent form's submission guard can execute, using a fresh CSP nonce; client metadata
remains escaped display data.

The stateless MCP adapter returns JSON for POST requests. Authenticated GET requests to `/mcp`
return `405 Method Not Allowed` with `Allow: POST`, as permitted by the
[Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server).
It does not open a standalone SSE stream or buffer an unending stream before returning HTTP headers.

Dynamic client registration validates the supported metadata and discards unsupported extension
fields before handing the request to the OAuth SDK, as required by
[RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html#section-2). This includes Codex's
`application_type: "native"`; it does not permit private-use callback schemes, additional scopes or
unsupported grants. Payload and admission budgets still apply before SDK writes.

## Resource budgets

| Budget | Initial limit |
| --- | --- |
| `MAX_ACTIVE_SESSIONS` | 3 live tabs, configurable up to 128 |
| `MAX_SESSIONS_PER_DAY` | 12 challenge attempts per UTC day; 12/IP/day for hosted acceptance |
| `MAX_CLIENTS_PER_DAY` | 24 DCR attempts per UTC day; 12/IP/day |
| `MAX_CONSENTS_PER_DAY` | 24 SDK consent transactions per UTC day; 12/IP/day |
| `MAX_TOKEN_REQUESTS_PER_DAY` | 48 token requests per UTC day; 12/IP/day |
| Tab lifetime | One hour, never extended |
| OAuth access token | 15 minutes; no refresh token |
| Dynamic client registration | One day TTL |
| Pending tab approval | 90 seconds |
| Pending tool operation | Six minutes, one operation in flight |
| Operations | 30/minute and 128 per tab lifetime |
| MCP request/browser frame | 192 KiB UTF-8; onboarding bodies have smaller limits |
| Complete MCP response | 512 KiB, including SDK text/structured output duplication; static tool discovery catalog up to 2 MiB |

Invalid configuration fails closed. The quota configuration requires
`2 * clients + 4 * consents + 4 * tokens <= 800`, reserving conservative SDK writes below Free's
1,000 KV writes/day. Defaults reserve 336 writes/day. Registration, consent and token-request
admission occurs before SDK writes. The remaining margin covers path-specific maintenance and
revocation; this reservation is an admission model, not a billing meter. Storage TTLs and the
bounded actor/request ledger prevent an unbounded live queue. Per-location coarse rate limiting is
eventually consistent; the admission object's global daily budgets are serialized.

Turnstile blocks tab allocation without a verified challenge. It does not authenticate a user or
protect standard DCR by itself. An anonymous distributed attacker can exhaust the bounded DCR
budget, causing denial of service until the daily reset. Personal initial deployment is therefore
distinct from scalable public onboarding; account admission or another approved registration policy
must precede that expansion. Free quota exhaustion returns failures rather than purchasing capacity.
The owner must verify that the account remains on Free; code cannot infer its billing plan.

Idle browser connections use WebSocket Hibernation. There is no 500 ms polling, periodic heartbeat,
stored document or hosted CAD kernel. The service still consumes Worker/DO requests, short active
duration during approval or a tool call, small SQLite metadata and OAuth KV. Actual CPU and quota
headroom have not been measured on the deployed Free account.

The SDK's Worker bundle uses AJV and its transitive `fast-uri`, pinned to 3.1.8 for the
[host-normalization fix](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj).
The shared SDK Node adapter's `ip-address` is pinned to 10.7.3, and Worker development tooling's
`sharp` to 0.35.4. These targeted pins preserve geometry dependencies and do not make the full
repository audit clean. Verify installed transitive resolution and the built bundle after changing
overrides; a successful lockfile check alone does not detect stale package links.

## Local verification and release gates

`bun run test:remote-mcp` runs the official Workers Vitest pool in local workerd, exercising actual
OAuth/PKCE, SDK consent, WebSockets, SQLite DOs and KV. Turnstile siteverify is mocked only in that
test runtime; deployment always calls the real verification endpoint. Root Vitest separately checks
browser lifecycle, explicit opt-in and existing local MCP regression behavior.

`bun run --cwd apps/remote-mcp build` bundles through Wrangler's local dry run. It creates no deployed
Worker or namespace. The compatibility date is pinned to 2026-08-22, supported by the official test
pool's workerd, and shared by the deployment config.

Release still needs independent approved code review, owner-authorized resource provisioning,
deployed HTTPS discovery, a real client's OAuth/tool invocation, real Turnstile/CSP behavior and a
real browser geometry/Apply/Undo journey through the remote connection. Local protocol tests and a
successful build do not prove any of those external behaviors or physical CAD output.

Primary references: [Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider),
[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) and
[Free resource quotas](https://developers.cloudflare.com/workers/platform/pricing/).

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

`model_surface_textures` reads bounded exact-revision layer summaries. `create_surface_texture`,
`update_surface_texture` and `remove_surface_texture` use owned proposals with mandatory native
relief preview and manual Apply. Packed grayscale maps support the full 256 by 256 editor size;
omitted map, face scope and mask stay unchanged on update. Removal requires destructive confirmation.
Native backups preserve editability; STL/3MF bake enabled relief and STEP stays untextured. Read the
[surface texture workflow](../.agents/skills/vibeshape-modeling/references/surface-textures.md).

Exact-body modifying operations are additive: `create_body_revolve`/`update_body_revolve` author
Revolve v7 Add/Remove/Intersect on a stable target role; `create_body_subtract`/`update_body_subtract`
author Subtract v2 with ordered exact target/tool roles, including distinct bodies of one producer.
Legacy names preserve their contracts. See the [modeling contracts](../.agents/skills/vibeshape-modeling/references/modeling.md)
for dependency ordering, tool retention, preview, and ordinary review/Apply.
