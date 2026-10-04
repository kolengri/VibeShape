# Remote MCP operation and limits

The remote adapter connects a standard HTTPS MCP client to the exact browser tab its owner approves.
It reuses existing CAD, sketch, variable, topology and metadata tools. The editor owns geometry,
documents, review, persistence and Undo. The local Bun/stdio workflow remains available separately.
See [ADR-0058](adr/0058-remote-mcp-paired-browser-transport.md).

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
Reload, disconnect, project changes or connection failures require a new pairing and fresh opt-in.
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

Assembly and local-library tools use the same paired authority on local and remote MCP. Read the
[assembly/library workflow](../.agents/skills/vibeshape-modeling/references/assembly-and-library.md)
for private draft versions, topology frames, immutable component versions and mandatory manual Apply.
Assembly previews are unsaved; callers cannot provide frozen pins or source bytes.

Exact-body modifying operations are additive: `create_body_revolve`/`update_body_revolve` author
Revolve v7 Add/Remove/Intersect on a stable target role; `create_body_subtract`/`update_body_subtract`
author Subtract v2 with ordered exact target/tool roles, including distinct bodies of one producer.
Legacy names preserve their contracts. See the [modeling contracts](../.agents/skills/vibeshape-modeling/references/modeling.md)
for dependency ordering, tool retention, preview, and ordinary review/Apply.
