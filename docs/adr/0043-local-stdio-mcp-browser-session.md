# ADR-0043: Local Stdio MCP and Browser-Owned Sessions

- Status: Accepted with reduced scope
- Date: 2026-09-07
- Related: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md), [ADR-0042](0042-exact-automation-draft-application-path.md)

## Decision

Accept the local transport subset of ADR-0013. `apps/mcp-server` is a Bun process using MCP stdio
and serving the production editor at `http://127.0.0.1:43114`. An explicit `--port` selects another
stable origin; startup fails on an occupied port or missing build instead of silently changing ports.
Browser storage remains origin-scoped: the bridge editor does not automatically share projects with
the development server or another port. Native project backup/import is the transfer path.

The process owns protocol translation, bounded memory-only export resources, and pairing. It has no
document database, native kernel, arbitrary file-write API, or generic command/script tool. The
browser owns registered queries, disposable exact geometry, review, ordinary persistence, and Undo.
The SDK is server-only. Shared contracts live in `packages/automation-api`; its existing dependency
on pure domain schemas remains unchanged. No document or persistence schema changes are introduced.

## Pairing and lifecycle

The static editor advertises bridge availability through a meta element. Ordinary hosted/development
editors do not probe the local API. The person opens a project, sees the client's bounded display
name, and selects **Enable AI session**. The name/version are self-reported MCP metadata, not a
verified publisher identity; the launching local client/process is the trust boundary.

One initialized stdio client pairs with one browser document. The server generates a 256-bit token
and a UUIDv7 MCP actor session. The token is returned only in the connect response and sent in the
Authorization header. It is never written to URLs, browser storage, logs, or native project files.
API requests require exact loopback Host and Origin, JSON POST, schema validation, and bearer
authentication after pairing. No CORS permission, remote HTTP MCP mode, or generic execution tool is
provided. Static navigation can omit Origin; cross-origin script/API requests are denied.

Browser polling continues while a tool waits for geometry or review. Poll sequence numbers increase
exactly once; work is delivered once and results must match the pending request, tool, document,
and relevant draft/revision. One tool operation can be pending. Same-document revisions keep the
pair; project changes, page exit, UI Disable, client shutdown, cancellation, expiry, or liveness loss
end it. Late browser continuations cannot attach to a replacement pair. Re-pairing creates a new
actor session and does not revive old drafts or export links.

Cancellation revokes the pair and disposes the browser worker/review when observed. Once an ordinary
persistence transaction has entered, disconnect cannot promise rollback: keep the applying review
until the actual commit result arrives. A lost MCP response is not proof that no write occurred;
reconnect and inspect the committed revision before proposing another change. Existing review,
writer lease, revision, command ownership, and one-transaction Undo checks remain authoritative.

## Supported first slice

Nine explicit tools are available: `model_info`, `create_draft`, `create_box`, `create_fillet`,
`update_fillet`, `preview_draft`, `commit_draft`, `discard_draft`, and `export_model`. Feature tools
require caller-supplied UUIDv7 command/feature IDs and draft revision preconditions. Fillet uses the
existing all-edge feature semantics. Output JSON is schema-validated and wrapped in `result`.

`vibeshape://model` reads the paired revision. Export returns a resource link under
`vibeshape://exports/{id}` for STEP, STL, or 3MF; resource reads return a base64 blob. There are no
arbitrary paths or writes on behalf of the MCP client. Model labels and names remain untrusted data.
The adapter reports actual queued, executing, review, and applying stages without fabricated kernel
percentages. Tool annotations describe these effects and do not replace host policy.

Bounds are explicit: 256 KiB stdio input buffering; eight concurrent HTTP requests; five-second body
read deadlines; 1 MiB ordinary result bodies; 6 MiB raw exports (8 MiB base64 plus envelope allowance);
120 tool invocations/minute; ten polls/second; 15-second browser liveness, checked every second;
one-hour pairing; six-minute operation timeout; four export resources expiring after five minutes.
The existing host allows four drafts per actor, 64 commands per draft, and five-minute draft inactivity.
Model measurements are bounded to 200 entries and retain the query's next-page marker.

The editor document's CSP prohibits dynamic JavaScript evaluation. Browser bootstrap configures
Zod's `jitless` validation before application schemas load, avoiding CSP-rejected probe attempts
without weakening schema validation. The pinned native binding needs
it inside the document worker, so only a Vite hash-named `worker-entry-XXXXXXXX.js` response gets that
exception. Worker response CSP is independent of document CSP, as specified in
[MDN's worker guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).
The static server rejects escaping symlinks and only serves approved file types from the build.

## Dependency and verification policy

Pin `@modelcontextprotocol/sdk` 1.30.0 (MIT) in the server workspace. The low-level SDK Server consumes
JSON Schemas generated from the shared Zod 4 contracts; local parsing remains authoritative. This
avoids coupling shared/browser schemas to the SDK's independently resolved Zod compatibility types.
The existing toolchain already resolved this SDK transitively through shadcn; it is now an explicit
server runtime dependency. Root overrides pin compatible `qs` 6.16.0 and `fast-uri` 3.1.6 because the
latest SDK's dependency graph still resolved vulnerable versions. Keep them until upstream resolution
is demonstrably safe. Preserve SDK and transitive notices in the release inventory.

The executable gate is real stdio discovery → explicit pairing → read → draft box → impossible
fillet → invalid preview/commit rejection → correction → exact preview → browser Apply → ordinary
commit/viewport → Undo/Redo → native reopen → STEP resource. Separate cases cover hostile origin,
oversized stdio input, client abort/close, UI revoke, in-flight persistence disconnect, stale
continuations, body limits/deadlines, and export expiry/revocation.

Verification on 2026-09-07:

- `bun run test`: 1,695 tests in 210 files passed.
- `bun run test:e2e` with the four `local-mcp*.spec.ts` files and the four
  `automation-document-commit`, `automation-document-cancellation`, `automation-review`, and
  `automation-draft-geometry` spec files, using `--workers=3`: all 54 cases passed in Chromium,
  Firefox, and WebKit after the bootstrap and compact-header fixes.
- `bun run typecheck`, `bun run format:check`, `bun run lint`, and `bun run build`: passed.
- `bun ci --ignore-scripts` and `bun audit`: frozen installation passed; no known vulnerabilities.
- `bun run fallow:audit`: exit 0, with two investigated warnings for the Bun dependency overrides.
  Both packages are resolved transitively in `bun.lock`; this override check expects pnpm metadata.
- Production-editor visual review covers light/dark themes at 1,024 px and a compact 512 px viewport.
  The compact header preserves the AI session action and truncates secondary text without overlap.

The initial cross-browser run exposed Firefox console errors from Zod's dynamic-evaluation probe.
The early `jitless` bootstrap resolved those errors in the real-client scenario in all three engines.

## Deferred scope

This accepts a useful local vertical slice, not complete CAD or MCP parity. Sketch/extrude/revolve,
chamfer, selected-edge repair, variables, paged inspection, richer model resources, durable tool-level
provenance, installed/offline update lifecycle, and performance/flood characterization need further
slices. Existing native history records command IDs and MCP actor/session, not a dedicated transport
tool-name field. No public extension SDK, remote transport, independently hosted PWA bridge, headless
model owner, release installer, or independent export interoperability certification is accepted here.
