# Automation and MCP architecture

The desktop host attaches external MCP clients to its already open project and runs installed ACP
agents through a narrow native bridge. Static web chat calls the person's compatible model API
directly and executes tools through the same browser-owned automation sessions. Neither path adds
a hosted AI worker or bypasses reviewed commands. See [ADR-0111](../adr/0111-native-project-assistant-and-handoffs.md)
and the [desktop connection workflow](../desktop-macos.md#ai-connections).

## Revision-bound visual inspection

`render_preview` is a read-only tool shared by local and remote MCP. Its explicit `source` selects
either a saved model at `revision`, or an actor-owned CAD draft at `draftId` and its current
`revision`. Default output is a labeled isometric/front/right/top PNG collage; one to four unique
standard views can be requested. An optional exact `featureId`/`outputRole` target selects one body,
including historical geometry, and never silently falls back to a whole feature or another body.
Alternatively, `camera` supplies world-mm `position` and `target`, an optional orientation `up`
vector, and optional `viewHeightMm`. Camera and standard views are exclusive. The orthographic
vertical span controls detail zoom and permits intentional cropping; omitting it auto-fits the
selected geometry from the requested angle. Metadata echoes the camera and labels the single view
`custom`. Changing camera distance alone does not change orthographic scale.

The browser composes complete CAD body meshes from an isolated disposable document-worker rebuild
and renders on a separate Three.js canvas. The live viewport camera, selection, document and Undo
history are untouched. The automation host serializes draft access and rechecks ownership, expiry
and base revision after asynchronous work; browser composition checks session cancellation and
saved revision before returning. Source assets use the ordinary materialization path. No Three.js
dependency enters the domain or automation host.

Metadata identifies the document, revision, rebuild generation, rendered body count and geometry
status; drafts also identify their draft and base revision. Invalid rebuilds may show surviving
bodies and remain explicitly invalid. Empty/unsupported geometry, stale work, unavailable WebGL
and unencodable bounded images return diagnostics. Assembly occurrence placement and surface-relief
layers are outside this CAD body render contract and must not be silently represented as complete.

The renderer retains all triangles, fits each view, and bounds raster size to 1024 by 768 pixels.
It may reduce raster resolution to keep the PNG within the wire budget, never sample away geometry.
Adapters return image bytes once in native MCP `image` content and place only image metadata in
text/structured output. Protocol schemas bound bytes and dimensions and validate PNG header sizes;
both brokers reject results with mismatched revision, source, draft, target or views. Native image
support in the MCP protocol does not prove a client passes images to its model.

Pictures complement exact measurements and diagnostics. They establish visible appearance rather
than exact dimensions, clearance, topology, printability or physical fit. Operator usage is owned by
[the inspection skill](../../.agents/skills/vibeshape-inspection/SKILL.md#visual-inspection).

## Browser-local project management

[ADR-0097](../adr/0097-mcp-project-management.md) extends the paired document workflow with a
separate browser-owned project-management grant. Shared local/remote tools list bounded catalog
pages and create/open projects through the ordinary controller and persistence paths. Expected
source identity/revision guards reject stale navigation; optional CAD `projectId` guards reject
wrong active targets. Authorized transitions replace the document handle without reloading or
reconnecting and dispose private work. Local connections restore the remembered CAD approval mode
on the destination handle; remote connections reset auto-apply on a different project. Manual navigation,
Stop and recovery do not carry this additional catalog/create/open grant.

## Recommendation

VibeShape exposes AI automation through local stdio, development HTTP, and explicitly paired remote HTTPS MCP adapters
over the ordinary document command and query contracts. MCP is an integration boundary, not a second
CAD engine, extension runtime, persistence layer, or privileged scripting API.

`bun run dev` embeds the existing local adapter and browser broker into Vite through a development-only
Streamable HTTP endpoint. It shares the editor origin and preserves explicit pairing and browser
review. The dev CLI runs Vite under the pinned Bun runtime so server-side TypeScript workspace
exports resolve consistently. Production builds and preview do not load this bridge. See
[ADR-0096](../adr/0096-development-http-mcp.md) for local boundaries and lifecycle.

The broad target remains proposed in [ADR-0013](../adr/0013-microkernel-modules-and-mcp-automation.md).
The implemented local stdio subset is accepted by [ADR-0043](../adr/0043-local-stdio-mcp-browser-session.md). The adapter-neutral host validates actor identities supplied separately from payloads, owns bounded expiring drafts, retains original parsed commands,
serializes operations, and delegates persistence to an atomic compare-and-commit port. Its required
geometry port now produces exact preview evidence. Preview schema version 2 combines the semantic
summary with bounded measurements and whole-draft geometry validity. Commit recalculates geometry
and rejects failed or blocked evaluations, stale bases, and expiry after asynchronous work.

Local and remote browser draft preview first perform a read-only document-authority preflight.
Retained commands are redispatched against the committed base and translated through the same
ordered History, authored Part and canonical projection rules used by persistence. The adapters
share transaction preparation with commit; preflight does not acquire a lease, write storage,
advance authority or record Undo. A rejected command returns its bounded index, ID, kind and
validation cause before geometry or Apply review. Commit repeats preflight before review and
still checks current authority during the actual write. This semantic simulation cannot certify
disk quota, a future writer lease or storage availability.

The application provides a disposable worker preview service with immediate cancellation, replacement,
late-result isolation, and worker termination. The trusted browser composition now connects the host
to the active project's ordinary persistent session. It redispatches retained original commands and
requires the resulting snapshot to equal the exact draft before writing. Successful commits publish
the saved revision to the editor and create one undo checkpoint; typed failures release the save lock
and reconcile lost writer access. An unexpected rejection means the commit could not be confirmed,
not proof that no write occurred.

The browser handle cancels private calculations when the committed revision changes and disposes
them on close, project change, or page exit. It is an internal composition boundary, not an exposed
MCP endpoint by itself. The local adapter now pairs it explicitly and exposes named tools, including the CAD authoring and inspection expansion in
[ADR-0044](../adr/0044-local-mcp-cad-authoring-and-inspection.md) and variable/Chamfer tools in
[ADR-0045](../adr/0045-local-mcp-variables-and-chamfer.md), followed by selected-edge inspection and authoring in
[ADR-0046](../adr/0046-local-mcp-selected-edge-inspection.md), and draft inspection in
[ADR-0047](../adr/0047-local-mcp-draft-inspection.md), and sketch-point Hole in
[ADR-0048](../adr/0048-sketch-point-holes.md), and constituent body measurements in
[ADR-0050](../adr/0050-constituent-body-measurements.md).
Commit requires host-owned browser review by default. An explicit, browser-owned grant may auto-apply
supported first-party CAD edits only in the current paired session; see
[ADR-0099](../adr/0099-complete-session-cad-auto-apply.md). Stop AI revokes that session immediately.
All geometry, revision, expiry, persistence, and Undo checks remain mandatory. See
[ADR-0042](../adr/0042-exact-automation-draft-application-path.md) and the exact transport scope in
[ADR-0043](../adr/0043-local-stdio-mcp-browser-session.md).

The editor and read-only `model_body_measurements` MCP tool consume
`org.vibeshape.model.body-measurements` through the same query dispatcher. The application projects
validated committed worker evidence into revision-bound metrics. Default reads list terminal bodies;
an explicit feature ID inspects historical outputs, and an output role selects exactly one body.
Missing roles never fall back to aggregate measurements. Pages contain at most 200 entries and
128 KiB of serialized UTF-8 data in canonical units. Trusted evidence is separate from query payloads;
a host without it returns unavailable. The existing `org.vibeshape.model.measurements` version 1,
`model_info` response, and exact draft preview retain whole-feature semantics. See
[ADR-0041](../adr/0041-revision-bound-model-measurements.md) and
[ADR-0050](../adr/0050-constituent-body-measurements.md) for ownership, validation, and limits.

The existing `create_hole` and `update_hole` tools accept optional
`parameters.targetBody: { schemaVersion: 0, featureId, outputRole }`. Supplying it selects the
existing Hole v2 contract from [ADR-0049](../adr/0049-constituent-body-identity-and-solid-patterns.md);
omitting it explicitly selects legacy Hole v1 whole-result semantics. Updates must resubmit the
body reference to retain v2 intent. The target feature must equal the first dependency, and a
same-producer sketch support can target only `result` until body-bound topology is available.
Clients obtain committed body roles through `model_body_measurements`. Missing roles fail exact
preview; they never resolve to another body. Both input variants are advertised as client-valid
JSON Schema and use ordinary domain commands, host review, persistence, undo, and exact exports.

The read-only `model_body_topology` tool exposes registered query
`org.vibeshape.model.body-topology` version 1. It inspects committed edges or faces for a required
feature/output-role pair and returns scoped v1 references with conservative resolution status.
Pages bind the full document/rebuild/body/kind provenance and are limited to 100 entries and
128 KiB UTF-8. Missing catalogs/roles and stale cursors fail closed. Existing `model_edges` and
`draft_edges` retain their separate selection contract. Shell is the explicitly versioned consumer
of body-bound face references and source hashes; Hole, Fillet and Chamfer do not accept them.
[ADR-0051](../adr/0051-body-bound-topology-inspection.md) records that staged boundary.

## Goals and non-goals

The integration must:

- let a model discover available CAD operations with machine-readable schemas;
- expose bounded document, selection, diagnostic, and print-analysis context;
- preserve the same validation, preview, confirmation, undo, persistence, and worker boundaries as human UI;
- identify the document revision used by every read and write;
- report real progress and support cancellation for long geometry operations;
- keep the active browser session authoritative in the initial local integration;
- make every committed model action attributable and inspectable by the user;
- remain useful with only first-party modules and expand safely as approved extension commands become automation-capable.

The first integration does not provide:

- arbitrary code, JavaScript, FeatureScript, shell, SQL, or expression execution;
- direct access to React state, IndexedDB, OPFS, raw `.vshape` ZIP entries, OCCT handles, B-Rep pointers, or extension hosts;
- unattended destructive commits, extension installation, permission grants, or network-capability approval;
- remote multi-user access or a public Internet MCP endpoint;
- a headless CAD authority that can edit files while the browser is closed;
- automatic exposure of every application or extension command.

## One command path

UI controls, first-party modules, third-party extensions, tests, and MCP all request the same domain commands. Adapters may shape presentation and transport, but they cannot bypass eligibility, normalization, revision, geometry, or persistence rules.

The browser shell also has a presentation-level editor command registry. Its serializable descriptors and trusted handlers deliberately mirror the domain registry's ownership and fail-closed composition rules so toolbars, palette items, and shortcuts share one eligibility decision. It is not an automation schema, transport contract, or permission grant: it may contain UI-only workspace and transient-tool actions, and no entry is exposed to MCP automatically. A future adapter may link a presentation command to a versioned domain command descriptor only after the automation host validates schema version, revision, confirmation class, and capability policy.

The current trusted dispatchers and automation host implement the first executable portions of this path. Serializable module, command, query, feature-type, and lifecycle contracts remain separate from function-valued first-party handlers and injected storage ports. Composition fails closed when a descriptor is missing a handler, a handler lacks a descriptor, registration is duplicated, owner or schema-version metadata drifts, or feature handlers use a different feature-type descriptor set. Dispatch validates the route, resolves the registered descriptor, verifies the requested schema version, and delegates strict payload validation to the owning handler. Variable mutations use the document module's ordinary draft-exposed commands. Registry-bound feature add/update handlers run pure document preflight, resolve authored expressions against the committed variable table, reject unavailable or invalid types, normalize parameters, and only then create the final event. The host wraps that path with owner, document, revision, duplicate-command-ID, expiry, and resource-limit checks. The command path reduces an isolated draft; the query path returns only its versioned bounded view; commit crosses one atomic port. A unit-aware box fixture traverses this exact path. Exact geometry and confirmation use separate required host ports; third-party runtime proxies remain open.

The feature module also registers `org.vibeshape.feature.remove` as a destructive, closed-world draft command. Its pure handler rejects dependency-owning features and emits a replayable prior-record event, and browser review uses the registered destructive confirmation class. Command-specific transport exposure remains gated until paired MCP conformance passes.

```mermaid
flowchart LR
    MODEL["AI client"] -->|"MCP stdio"| BRIDGE["Local Bun MCP bridge"]
    BROWSER["Paired browser session"] <-->|"authenticated loopback session"| BRIDGE

    subgraph APP["VibeShape application"]
        MCPADAPTER["Automation coordinator"]
        QUERIES["Snapshot and query registry"]
        COMMANDS["Command registry"]
        DRAFTS["Disposable draft manager"]
        POLICY["Consent and capability policy"]
        DOMAIN["Document transactions and history"]
        WORKERS["Geometry and analysis workers"]
    end

    BROWSER --> MCPADAPTER
    MCPADAPTER --> QUERIES
    MCPADAPTER --> POLICY
    MCPADAPTER --> COMMANDS
    COMMANDS --> DRAFTS
    DRAFTS --> DOMAIN
    DRAFTS --> WORKERS
```

The bridge contains protocol, static-delivery, and session state only. It does not deserialize a private copy of the document or modify local project storage. If the browser disconnects, mutating tools fail closed and all uncommitted automation drafts expire.

## Module and command exposure

Every cohesive product module registers contributions with stable ownership metadata:

```text
ModuleDescriptor
  id
  version
  compatibility
  dependencies[]
  featureTypes[]
  commands[]
  queries[]
  analyses[]
  codecs[]
```

The exact schema remains gated by the domain and extension spikes. Durable constraints are:

- module IDs and contribution IDs are stable technical identifiers;
- dependencies are explicit and acyclic;
- registration order cannot change document evaluation semantics;
- command ownership, schema version, eligibility, and diagnostics are queryable;
- user-facing labels remain localized host or module catalog entries, never protocol identity;
- disabling an optional module preserves unknown feature payloads and reports typed diagnostics.

First-party modules may use trusted React or worker entry points, while third-party UI remains sandboxed. They share contribution meaning, not ambient runtime authority. Kernel services never pretend to be optional modules.

Candidate first-party module families are:

- `org.vibeshape.core.sketch`;
- `org.vibeshape.core.part-design`;
- `org.vibeshape.core.exchange`;
- `org.vibeshape.core.print-analysis`;
- `org.vibeshape.core.measurement`.

These are logical identities, not a commitment to one Bun workspace per module. Package extraction follows demonstrated dependency, execution, ownership, or publication needs.

The current registry starts with `org.vibeshape.core.document`. Its document create/rename, variable mutation, and sketch add/update/remove commands are the conformance fixtures for command ownership, explicit schema versions, confirmation classes, automation annotations, and deterministic registration. Sketch removal is explicitly destructive; add and update require review. The same module owns exact-revision document-summary, cursor-paginated variable-list, and bounded
model-measurement queries. Solved sketch inspection is exposed through a bounded registered query and named tools as described in [ADR-0085](../adr/0085-disposable-solved-sketch-inspection.md); models and the UI share the trusted revisioned sketch-command dispatcher.

## MCP primitives

Surface texture automation uses four named tools and a narrow owned proposal coordinator, as
specified in [ADR-0090](../adr/0090-owned-surface-texture-mcp-proposals.md). The current authored
collection is controller-owned; caller input is a recipe, patch, appended dabs or exact layer
removal. Packed byte maps retain full UI-sized custom images within the ordinary wire budget.
Native relief evidence and the manual viewport review precede the private, exact-intent authored
commit port. Texture mutations remain outside CAD auto-apply and do not expose generic commands.

MCP distinguishes model-controlled tools, application-provided resources, and user-selected prompts. The current adapter implements tools and resources. The broader resource catalog, generated-tool design, and prompts below remain targets beyond ADR-0043.

### Resources

Resources are read-only, bounded, serializable views. Candidate URI templates include:

```text
vibeshape://session
vibeshape://documents/{documentId}/summary
vibeshape://documents/{documentId}/variables
vibeshape://documents/{documentId}/feature-tree
vibeshape://documents/{documentId}/selection
vibeshape://documents/{documentId}/diagnostics
vibeshape://documents/{documentId}/print-analysis
vibeshape://documents/{documentId}/drafts/{draftId}/preview
```

Every document resource includes `documentId`, `revision`, schema version, truncation or pagination state, and whether values are semantic state or derived evidence. Large meshes, B-Rep payloads, arbitrary extension HTML, secrets, file handles, and hidden application state are not resources.

`@vibeshape/automation-api` implements two semantic views. `org.vibeshape.document.summary` schema version 1 requires an exact document revision and returns name and timestamp fields with `truncated: false`. `org.vibeshape.variable.list` schema version 1 requires the same revision, accepts a bounded cursor and limit, and returns authored definitions, canonical evaluated dimension/value/unit triples, dependency names, and a next cursor. Neither view exposes an event log, actor data, mutable object graph, storage identity, file path, or geometry payload. The local adapter maps the document summary and bounded measurements to `vibeshape://model`; variable and other semantic URI mappings remain future work.

Resource subscriptions may announce that a view changed, but a client must reread and validate the new revision. Notifications are never a delta mutation protocol.

### Tools

The adapter exposes explicit schema-backed tools. The first nine names are recorded in ADR-0043; ADR-0044 adds six CAD authoring tools and two inspection tools; ADR-0045 adds five variable commands, variable inspection, and two all-edge Chamfer tools. ADR-0046 adds exact edge inspection and selected-edge treatment inputs. ADR-0047 adds four draft inspection tools. The broader lifecycle naming below is proposed, not the current discovery response:

| Tool | Effect | Commit behavior |
|---|---|---|
| `vibeshape.draft.create` | Create a disposable draft from one committed revision | Read-like allocation; no document mutation |
| `vibeshape.draft.validate` | Rebuild and return structured diagnostics and invariants | No document mutation |
| `vibeshape.draft.discard` | Destroy one automation draft | Idempotent cleanup |
| `vibeshape.draft.commit` | Request commit of a valid draft | Requires matching base revision and host policy |

The broader design would generate modeling tools from automation-approved command descriptors, for example `vibeshape.feature.extrude` or `vibeshape.feature.fillet`. They apply only to a named draft. Each descriptor defines:

- JSON input and structured output schemas;
- command and parameter schema versions;
- owning module and required capabilities;
- read-only, destructive, idempotent, and open-world annotations;
- eligibility and revision requirements;
- preview support and confirmation class;
- progress stages, cancellation behavior, output limits, and stable diagnostics.

MCP tool annotations are advisory interoperability metadata. VibeShape enforces all rules independently and does not trust a client or model to interpret annotations correctly.

There is no generic `apply_command`, `execute`, `run_script`, `install_extension`, `grant_permission`, or raw-document mutation tool in the initial surface. Explicit tools improve discovery, schema validation, consent copy, audit, and compatibility.

### Prompts

Optional prompts may guide user-selected workflows such as inspecting printability, designing a bracket, or repairing a failed feature. Prompts do not gain authority, hide tool invocations, or commit changes. Their output remains subject to the same draft and confirmation flow.

## Bundled operator instructions

Both transports expose `vibeshape://agent-skills` and the finite Markdown documents it indexes, plus a read-only `read_agent_skill` fallback for clients exposing only tools. Initialization instructions direct the agent to the index and relevant workflows. This loads instructions at runtime; it does not install client files, grant document access, or enable auto-apply.

The canonical five application-use skills live under `.agents/skills`. `bun run skills:bundle` embeds their Markdown in `automation-api/agent-skills`, rewriting relative links to resource URIs. `skills:validate` rejects missing/stale generated data. Both Worker and relocatable Bun builds include the content, with no runtime filesystem or outbound-network reads. Resource lookup accepts only exact catalog URIs and each generated document is limited to 64 KiB.

Local static reads are available before pairing. Remote static reads retain the `/mcp` OAuth scope/client/live-tab checks and response-size limit, but do not invoke browser work or CAD operation budgets. Document and export authority remain separate. See [the skill pack](../agent-skills.md) for discovery, installation and maintenance.

## Host-owned browser review

The required review port receives detached parsed commands, actor identity, and an exact version-2
preview only after whole-draft geometry is valid. It returns one validated decision: approved,
rejected, or cancelled. There is no client approval field, reusable approval token, or production
always-approve fallback. The host serializes draft operations while review is pending and rechecks
the committed revision and expiry after approval, before crossing the ordinary persistence port.

The browser renders the review in its responsive task panel, with command summaries, common authored
dimensions, sketch/variable summaries, and bounded exact output measurements. Destructive confirmation
uses the built-in registry metadata. Apply stays pending through persistence; Discard removes the
owned draft. Expiry, a changed document, or session closure cancels a pending review and retains a
bounded message that can be dismissed. A request-specific UI identity prevents an old button from
approving a later review. Only one session can own the confirmation surface at a time.

An idle paired user may explicitly opt in to the supported first-party CAD scope in
[ADR-0099](../adr/0099-complete-session-cad-auto-apply.md), including feature/sketch/variable lifecycle
edits and removal, supported schema upgrades and all shipped CAD feature versions. Import features,
metadata and separate review services retain their existing manual-review contracts. The browser
then approves qualifying valid drafts through the same review port, with a persistent Auto-apply on
indicator and Stop AI control. An existing review cannot acquire this grant retroactively. All
other drafts keep the review surface above; explicit Stop AI clears local access and its remembered preference. Local access and the latest
explicitly chosen approval mode survive project changes and fresh browser sessions for the
remembered client, as described in [ADR-0100](../adr/0100-remembered-local-mcp-preferences.md).
Recovery credentials remain tab-scoped. Remote disconnect recovery retains its separate consent rules. The
bottom status bar exposes neutral connection and Stop AI controls plus an approval-mode menu.
Returning an idle session to manual review clears its browser-owned grant without revoking pairing;
active operations or reviews block that change. No MCP tool can change either approval mode.

Local `commit_draft` has no absolute broker execution deadline while its browser remains live and
authorized. Heartbeats, cancellation, revocation and credential/approval expiry remain enforced;
other local operations retain their bounded execution deadline.

Once the ordinary atomic persistence operation has started, cancellation is not a rollback request.
The editor keeps action controls locked while it completes. Unexpected persistence failures remain
explicitly unconfirmed; they are not converted into a claim that storage was unchanged. Transport
pairing, request cancellation, revocation, and closed-browser behavior still need a real client test.
The first review presents semantic summaries and metrics, not a general visual geometry diff or a
complete topology inspector. Command-specific MCP exposure must respect that inspection scope.

## Draft, preview, and commit

The target mutating sequence is transactional. The current slice records command IDs and MCP actor/session provenance; dedicated tool names and request correlation in durable history remain deferred:

1. Create a draft from `documentId` and `baseRevision`.
2. Apply one or more explicit feature commands to that draft.
3. Rebuild through the normal worker and receive progress, diagnostics, invariant summaries, and a bounded preview resource.
4. Present the proposed changes in host-owned UI, including the MCP client, tool names, affected features, and warnings.
5. Commit atomically only when the base revision still matches and policy permits the operation.
6. Record normal undo history plus `actor = mcp`, session identity, client identity, tool names, and request correlation IDs.
7. Reject conflicts without rebasing or guessing. The model must reread and create a new draft.

A disconnected, cancelled, timed-out, invalid, or rejected request cannot leave partial committed geometry. Drafts have owner-bound unguessable IDs, inactivity expiry, memory limits, and a per-session concurrency limit.

The current `@vibeshape/automation-host` retains original validated commands in owner-bound drafts,
serializes operations, checks inactivity and command limits, and requires exact geometry and browser
review before commit. A failed or stale atomic commit retains the draft for inspection or explicit
discard; a successful commit removes it. The injected document port owns durable compare-and-commit.
The local adapter exposes box and all-edge fillet creation/correction through this path, with real
client tests for progress, revocation, and ordinary persistence/Undo. It exposes no generic command
execution tool. Disconnect during an already-entered persistence transaction cannot guarantee rollback;
the editor waits for its actual result, and a reconnecting client must inspect the current revision.

## Local transport and pairing

The first bridge uses MCP `stdio` because the client launches a local subprocess and the protocol channel does not require a listening MCP port. Protocol JSON is the only stdout content; diagnostics use stderr.

The browser still needs an explicit local session with the bridge. The initial automation mode serves the reviewed production static build and its session endpoint from one stable loopback origin. Normal hosted and installed PWA modes remain independent and do not require this process.

The loopback origin has these requirements:

- bind only to `127.0.0.1`; a stable per-profile origin preserves browser storage identity;
- validate the exact `Host` and `Origin`, reject absent or unexpected origins, and provide no wildcard CORS;
- require an initial host-owned **Enable AI session** user action; remember local access and approval
  mode for the approved client and browser origin under [ADR-0100](../adr/0100-remembered-local-mcp-preferences.md);
- authenticate every browser request with a session-bound, same-origin credential that is never placed in a URL;
- bind one bridge session to an explicit set of shared documents and capabilities;
- enforce sequence, size, frequency, lifetime, and concurrent-request limits;
- revoke immediately on explicit Stop AI and dispose replaced document/client authority; temporary
  local interruption suspends access for authenticated same-origin, same-document and same-client
  recovery under [ADR-0095](../adr/0095-local-mcp-continuous-recovery.md). Remembered local access
  permits fresh pairing after project changes or stale credentials without displacing an active owner;
- fail startup rather than selecting a different storage origin silently when the configured local origin is unavailable;
- never assume that loopback or same-origin delivery implies user consent.

Connecting an already open app from another origin is deferred. Its spike must cover CSP `connect-src`, mixed-content behavior, CORS, Private Network Access, DNS rebinding, pairing UX, and Chromium, Firefox, and WebKit behavior before that mode is documented as supported.

Streamable HTTP is deferred. If introduced, it requires the MCP authorization profile, origin validation, localhost-only defaults for local mode, secure session IDs, token audience validation, and a separate deployment threat model. Remote HTTP is not enabled by a command-line flag on the local bridge.

## Remote HTTPS transport and pairing

`apps/remote-mcp` implements OAuth-protected Streamable HTTP on a Cloudflare Worker and SQLite
Durable Objects. The exact editor tab explicitly pairs a hibernating WebSocket and approves one OAuth
client. Required Turnstile verification and global admission budgets precede tab allocation and
OAuth writes. The service routes existing named operations to the browser's ordinary automation
handle; it does not own geometry or project storage. Tool metadata is shared with the local adapter.
Remote file resources remain deferred while ordinary editor exports continue to work.

Manual Apply and the explicit session-only auto-apply policy remain unchanged. Revocation disposes
browser authority immediately, and every remote request checks live tab/client authorization.
Disconnected or uncertain writes are never queued for replay. Exact failure, configuration and
personal Free-plan admission limits are defined in
[ADR-0058](../adr/0058-remote-mcp-paired-browser-transport.md) and
[Remote MCP operation and limits](../remote-mcp.md). Public onboarding beyond the bounded personal
deployment needs a separate admission decision and deployed evidence.

## Progress, cancellation, and long tasks

MCP progress tokens map to command execution IDs. The coordinator forwards real worker stages and never invents precision that the kernel cannot provide. Notifications are rate-limited and stop after a terminal result.

Cancellation requests propagate to draft evaluation and worker generation cancellation. If the underlying kernel cannot interrupt safely, VibeShape terminates the disposable worker and rebuilds the last committed document state. A cancelled operation remains cancelled even if lower-level work completes later.

Long-lived task support may be added after the base tool flow passes. Task IDs must be cryptographically unguessable, scoped to the paired session, bounded by TTL and concurrency, and inaccessible after revocation.

## Extension interaction

An extension can propose automation metadata for one of its registered commands, but the host controls exposure. A command appears through MCP only when:

- the exact extension artifact is installed, enabled, compatible, and not quarantined;
- its runtime capabilities are granted independently of MCP;
- its command schema passes the automation conformance suite;
- the host classifies its effects and confirmation requirements;
- all inputs and outputs are bounded and serializable;
- its deterministic or side-effect behavior matches the declared annotations.

MCP never expands an extension's capability grant. An MCP client also receives no general extension-management or catalog capability. Disabling or revoking an extension removes its tools and invalidates its active drafts.

## Owned draft inspection

`draft_tree`, `draft_entity`, `draft_variables`, `draft_edges`, `draft_body_measurements` and
`draft_body_topology` require the owned draft ID and its
exact current revision. They dispatch the existing registered queries over the draft snapshot and
return `{ schemaVersion, draft, view }`. The browser injects the paired document; the broker binds
successful responses to the draft, revision, view kind, target and edge cursor. Inspection is
read-only and does not renew the draft expiration time. Semantic reads do not start a geometry worker.

Draft edge inspection calculates one requested feature in a disposable worker, projects measurements
and exact edge evidence from the same rebuild, and terminates the worker. Failed downstream geometry
does not hide a successful source feature. The host retains one detached catalog of at most 4 MiB,
with no meshes or native handles. Pages reuse its rebuild identity. Commands invalidate affected
catalogs; stale cursors require restarting at `cursor: null`. Ownership, expiration and the committed
base revision are checked before and after asynchronous work. Creating source geometry, inspecting
edges and repairing selected treatments can therefore precede one final browser Apply.

Draft body inspection reuses the registered committed body-measurement and body-topology query
contracts over disposable worker evidence for the exact draft snapshot. Roles, content hashes and
face references remain scoped to one producer/body and rebuild. Current draft topology can select
Shell openings without an intermediate saved solid. Source edits invalidate discovery cursors; existing Shell v2 openings retain only unique durable face identity, and unresolved selections require explicit reselection;
draft authority and cursor validation remain mandatory before and after asynchronous evaluation.

`model_info.diagnostics` and `preview_draft.geometry.diagnostics` expose revision/generation-bound
model health independently of successful solid measurements. Entries identify the affected feature
or sketch, authoritative failure code/values, blocked dependencies, support producer and a repair
action where relevant. Support and external-reference health reuse the editor's resolution evidence;
missing or ambiguous support remains visible even when semantic frame evaluation produces a solid.
Unknown or unavailable health is distinct from valid health, and bounded output fails explicitly
rather than silently truncating diagnostics.

Mirror v2 extends the existing Part Design owner with a signed length offset and explicit source
preservation. Its reflected feature still exposes one `result` body. A preserved source retains
its current authored part while the reflected result receives an independent part; a subsequent
Union selects the two exact producer references. Legacy v1 replacement and content identity remain
unchanged. See [ADR-0077](../adr/0077-mirror-copies-and-draft-shell-selection.md).

## Security and privacy

The user explicitly pairs a client and chooses which document sessions are shared. Pairing one document does not expose the project library, recent files, other tabs, extension storage, or browser origin data.

The bridge and application enforce:

- deny-by-default tool and resource exposure;
- runtime validation at MCP, loopback, query, command, worker, and extension boundaries;
- user-visible invocation and commit history;
- explicit confirmation for mutating and destructive work;
- revision preconditions and idempotency keys;
- prompt and resource size limits plus pagination;
- redaction of paths, tokens, private extension data, and diagnostic internals;
- rate, CPU, memory, task, draft, and output limits;
- session-scoped audit records without storing model prompts by default.

Tool descriptions, extension catalogs, document names, parameters, and imported metadata are untrusted content. They cannot modify tool definitions, capability policy, confirmation copy, or host instructions.

## Implementation boundaries

The executable document-summary query justifies the first package boundary. The remaining boundaries are created only when their own executable slices require them:

```text
packages/
  automation-api/        # implemented: serializable query and draft lifecycle contracts
  automation-host/       # implemented: owner-bound draft and query/command coordination

apps/
  mcp-server/            # local Bun MCP transport and authenticated browser pairing bridge
  remote-mcp/            # HTTPS OAuth transport and bounded per-tab coordination; no CAD authority
```

The MCP SDK belongs only in `apps/mcp-server` and `apps/remote-mcp`. Domain, geometry, persistence,
and feature packages never import it. The browser depends on the adapter-neutral automation protocol
rather than MCP types. Cloudflare runtime and OAuth dependencies belong only in `apps/remote-mcp`.

`packages/automation-api` and `packages/automation-host` are checked in because the document-summary query and owner-bound draft lifecycle execute end to end in tests. `apps/mcp-server` now implements the first paired transport slice. Its command list and limits are
explicitly narrower than the target contract in this document; see ADR-0043.

## Acceptance gate

The first MCP spike must prove:

1. A local client can discover resources and tools through `stdio` without non-protocol stdout output.
2. The browser pairs and revokes a session without exposing another document or accepting a hostile web origin.
3. A read resource is bounded, revision-tagged, and invalidated correctly after a commit.
4. An automation-approved feature command creates a draft, reports progress, previews, confirms, commits once, and participates in undo/redo.
5. Stale revisions, duplicate requests, cancellation, browser disconnect, worker crash, invalid schemas, and output floods fail without partial committed state.
6. Tool annotations and structured outputs match actual behavior, while host policy still denies unsafe requests independently.
7. An extension command remains hidden until all extension and automation gates pass and disappears immediately on revocation.
8. The complete scenario works offline from the bridge-served static build and records inspectable provenance without storing model prompts.

The initial SDK pin and local configuration are covered by ADR-0043. Broader conformance, extension
exposure, offline installation, and full command/resource coverage remain release gates.

## Expanded exact feature authoring

Local stdio and paired remote MCP expose create/update tools for Datum Plane, Boolean subtraction,
Union, Compound, Mirror, body Pattern, Shell, Split, Sweep, Loft and custom Thread through shared
schemas and descriptions. Datum Plane create/update writes feature schema v2 with explicit
origin/planar-face support, signed offset and optional support-local X/Y rotation. Strict offset-only
v1 remains readable; an explicit update upgrades the same feature identity, as specified in
[ADR-0114](../adr/0114-versioned-angular-datum-planes.md). Boolean retains v1 ordered target/tool whole-result scope. Union/Compound
use v2 ordered exact-body slots, including several roles from one producer, with deduplicated
first-occurrence producer dependencies and no topology references. Compound retains authored
slot UUIDs on update. Missing roles and disjoint Union results fail exact preview.
Loft v1/v2 support two to twenty-four sections and up to twenty-four ordered producer dependencies.
Version 2 adds explicit hole tracks. Version 3 adds directed outer correspondence, boundary rails,
named C0 guides and independent G1/G2 end support faces, within a 128-producer budget; its matching
sections must be hole-free open-segment boundaries. All versions retain the 2,000-curve budget.
Unresolved exact support faces or failed native residuals require repair. Other evaluation requests
retain the eight-producer limit.
Exact named-body
selection, stable dependencies, variable quantities, draft preview and ordinary review/commit
remain authoritative. Shell create/update authors version 2: empty openings create a closed cavity,
while selected openings bind exact-body topology and the source content hash. Unique durable
face identities may survive source edits; missing or ambiguous identities require explicit repair.
Existing version 1 records keep strict source binding until updated. Sweep retains its
explicit path start frame; Loft retains ordered bounded sections; Thread is bounded custom
60-degree geometry without ISO/DIN fit certification. The modeling operator skill and local
authoring guide describe these limits. Native source imports now use the bounded paired upload/inspection/manual review path in
[ADR-0091](../adr/0091-paired-native-source-imports.md). Planar drawing import uses its separate
paired upload, analytical review and ordinary editable Sketch transaction in
[ADR-0092](../adr/0092-paired-planar-source-imports.md). Assembly/library authoring uses owned drafts
and manual Apply under [ADR-0089](../adr/0089-owned-assembly-and-library-mcp-drafts.md); surface texture
authoring uses the native relief proposal path under [ADR-0090](../adr/0090-owned-surface-texture-mcp-proposals.md).
Prepared binary exports are shared by both transports; the legacy monolithic export remains local.

Manual review remains the default. The browser-owned explicit session grant additionally permits
Union schema v2 and Loft schema v1/v2/v3 creation and same-version updates. Actor/document matching,
valid exact preview, unsuppressed matching prior versions, expiry and persistence remain mandatory.
Compound, version upgrades and future feature versions require manual review.

`model_measurements` and `draft_measurements` expose paged feature evidence. Their default
`scope: "terminal"` preserves terminal-output behavior; `scope: "all"` includes upstream failed
and blocked features. Draft feature measurement paging shares the existing single detached
4 MiB geometry catalog, ownership and expiry checks. Another target or draft edit invalidates
cursors without retaining a worker or renewing expiry.

## Solved sketch inspection

`model_sketch_solution` and `draft_sketch_solution` share `org.vibeshape.sketch.solution` version 1.
They solve a detached exact-revision snapshot in a disposable worker and return native status,
DOF, conflicting constraint IDs, solved authored coordinates/radii and stable usable profile
selectors. Section-bound opaque cursors page at most 200 entries within 128 KiB. Catalogs are
limited to 4 MiB; the committed reader retains one sketch catalog, while draft reads share the
existing one-target geometry catalog. Ownership, expiry, active document and revision remain
validated around asynchronous evaluation. No read saves coordinates or advances a revision.
See [ADR-0085](../adr/0085-disposable-solved-sketch-inspection.md) for evidence validation,
cancellation and cursor recovery.

## Owned assembly and library authoring

Local and paired remote MCP expose the same named assembly/library vocabulary. Assembly drafts retain
an original committed base, actor/session ownership, five-minute expiry and private draft version.
The controller captures immutable sources and exact worker evidence; callers cannot submit pins,
closure bytes, arbitrary commands or approval flags. Explicit upgrade enables general mate graphs
while preserving old v1 forests. Manual browser Apply always precedes a second exact preflight and
the ordinary authored revision CAS/Undo transaction. Library writes additionally recheck the captured
authority inside their atomic transaction after asynchronous hashing/reads; cancellation rolls back
staged bytes, versions and metadata. Immutable version selection, copy/reference insertion and
metadata CAS remain explicit. Read views omit meshes and bytes and use bounded frozen-topology pages.
See [ADR-0089](../adr/0089-owned-assembly-and-library-mcp-drafts.md) and the
[assembly/library operator workflow](../../.agents/skills/vibeshape-modeling/references/assembly-and-library.md).


## Reviewed saved-change navigation

`model_history_state` reads the paired document's current Undo/Redo availability; `model_history` continues to describe authored item ordering. `undo_model` and `redo_model` create five-minute, actor-owned, browser-only target reviews. All three require the current document ID and revision context from `model_info`; navigation additionally requires a fresh command identifier. Manual Apply/Discard remains required with auto-apply enabled.

The ordinary adapter's cloned read-only checkpoint feeds disposable exact model and assembly preview with repository-owned source assets. The historical snapshot never becomes an MCP result or caller input. After exact review and target revalidation, the existing session history queue, write lease and revision CAS publish one actor-preserving restore event. The target revision is historical; the publication revision advances by one. Cancellation after authorized publication starts settles the actual save outcome. Reopening preserves saved state/events but resets transient checkpoint stacks. See [ADR-0093](../adr/0093-reviewed-mcp-history-navigation.md) and the [organization operator workflow](../../.agents/skills/vibeshape-organization/SKILL.md).
