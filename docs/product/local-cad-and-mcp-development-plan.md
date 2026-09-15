# Local CAD and MCP development plan

Audit date: **2026-09-04**. Status: **execution approved; delivery in progress**.

This plan describes the current working tree, including the uncommitted modeling and workflow
changes. It sets the next delivery priorities; it does not approve a new architecture or certify a
release. The broader [roadmap](../roadmap.md) remains background context. Accepted ADRs remain
authoritative; [ADR-0013](../adr/0013-microkernel-modules-and-mcp-automation.md) is still proposed.

## Gap review: 2026-09-13

This review checks the current working tree rather than assuming that domain or worker support is
already reachable from the product. Prior dated evidence below remains historical.

| Order | Confirmed gap | Next deliverable and acceptance |
| --- | --- | --- |
| 1 (closed) | At audit start, Hole v2 existed in the domain/native worker but was unavailable through the form, edit routing, and local MCP | Exact body selection is now implemented; see the delivery record below for compatibility and lifecycle evidence. |
| 2 (partial) | Body-scoped committed edge/face inspection is implemented; persisted topology consumers and native selected-edge snapshots remain feature-scoped | Add per-output native topology snapshots, explicit Fillet/Chamfer feature versions and role-sensitive reference identity, then UI/MCP authoring and explicit repair. Prove coincident sibling isolation, undo/reopen, and exports. |
| 3 | No native linear/circular pattern producer exists | Deliver independent linear copies after body-aware consumers and mesh-memory limits, then circular copies. Prove sibling preservation through downstream edits, undo/reopen, exports, and MCP. |
| 4 | Existing CAD capabilities still exceed MCP coverage | Add Box update, Cylinder create/update, Boolean/Subtract, and Datum Plane operations over ordinary commands. Add profile inspection and connect body-scoped face references to versioned modeling consumers. Tool discovery alone does not establish parity. |
| 5 | Recovery-to-backup and installed local release gates remain open | Allow verified journal recovery to produce a portable backup without an unrelated edit; then prove offline reopen, two-build updates, worker recovery, startup/rebuild performance, and bounded memory. |

The first implementation from this review closes item 1 under accepted ADR-0049. UI and MCP now
converge on the existing versioned Hole command without a new engine or persistence schema.
This also corrects an audit omission: body-aware measurement and rendering did not by themselves
make the existing Hole v2 authorable. The local MCP surface currently contains 33 tools; accepting
a body selector in existing Hole tools does not increase that count.

## Hole body-target delivery: 2026-09-13

Item 1 of the gap review is implemented. The form recognizes both Hole versions, creates named
body targets as v2, preserves legacy v1 edits, and requires an explicit replacement for a missing
body role. Options follow validated terminal-body consumption, so a cut consumes only its chosen
role and leaves siblings available. The existing `create_hole` and `update_hole` MCP tools accept
`parameters.targetBody` through ordinary versioned commands. Omitting that parameter explicitly
selects legacy v1 semantics. No new tool or persistence version was introduced.

Validation passed:

- `bun run test --maxWorkers=4`: 1,961 tests across 241 files; the final form assertions also pass
  in a focused 17-test rerun.
- `bun run typecheck`, `bun run format:check`, and `bun run lint` passed.
- `bun run fallow:audit` passed with zero complexity/duplication findings. Its two override warnings
  are false positives for transitive `qs` and `fast-uri`: both are pinned and used in `bun.lock`.
  No dependency override was removed or suppressed.
- `bun run build` passed with the existing chunk-size and ineffective dynamic-import warnings.
- `bun run test:e2e tests/e2e/hole.spec.ts tests/e2e/local-mcp-hole.spec.ts tests/e2e/body-output-worker.spec.ts tests/e2e/document-export.spec.ts --workers=1`:
  all 24 Chromium/Firefox/WebKit cases passed in one uninterrupted 5.2-minute run without retries.
  The matrix covers both Hole schema versions over real paired MCP, UI creation/editing in both
  themes, exact native preview, invalid-role rejection and repair, host Apply, Undo/Redo, native
  backup/reopen, and STEP/STL/3MF exports. Desktop and compact screenshots were inspected.
- Local Markdown links, English-language scans, and `git diff --check` passed.

The next implementation from this delivery was item 2; its inspection increment is recorded below.
Persistent body-bound authoring/repair, MCP parity, and local-release gaps remain open.

## Body topology inspection: 2026-09-13

The first part of item 2 is implemented under [ADR-0051](../adr/0051-body-bound-topology-inspection.md).
The new committed `model_body_topology` MCP tool reads exact named-body edges or faces through a
registered ordinary query. The surface now has 34 tools. Separate v1 inspection references bind the
producer and output role; full-source uniqueness and conservative resolution prevent coincident
sibling topology from being silently substituted. Cursors bind document/revision, generation,
rebuild request, source hash, body, and kind. Missing/partial catalogs, stale pages, and malformed
provenance fail closed. Pages are bounded to 100 references and 128 KiB UTF-8.

This is a read-only reference contract. Existing modeling commands still reject v1 body references;
ordinary persisted TopoRef v0, feature versions, native file format, and worker protocols are unchanged.
Real-kernel acceptance uses named single-solid `result` outputs from Box/Hole. Coincident siblings are
synthetic application/domain isolation tests, not evidence of a native multi-copy producer.

Final unit verification: `bun run test --maxWorkers=4` passed 1,986 tests across 245 files.
Full `bun run typecheck`, `bun run format:check`, `bun run lint`, and `bun run fallow:audit` passed;
Fallow retains only the two known transitive-override warnings. `bun run build` passed with the
existing chunk-size and ineffective-dynamic-import warnings.

`bun run test:e2e tests/e2e/local-mcp-body-topology.spec.ts tests/e2e/local-mcp-hole.spec.ts tests/e2e/local-mcp-edges.spec.ts tests/e2e/local-mcp.spec.ts --workers=1`
passed all 18 Chromium/Firefox/WebKit cases in one uninterrupted 5.6-minute run without retries.
Review then identified inconsistent root geometry with an otherwise valid body catalog; invalid,
zero-volume, and zero-solid roots now fail before projection, with focused regressions. The final
`bun run test:e2e tests/e2e/local-mcp-body-topology.spec.ts --workers=1` rerun passed all three
browsers against the rebuilt application. Local documentation links, English-language checks, and
`git diff --check` also passed.

Next deliver per-output native topology capture and explicitly versioned selected-edge Fillet/Chamfer
consumers, including canonical body/reference input identity, persistence/replay, UI/MCP authoring,
and explicit repair. Sketch support requires its own versioned adoption. These are prerequisites to
claiming Stage 2 complete; linear/circular pattern authoring remains subsequent work.

## Delivery update: 2026-09-05

Committed Undo/Redo now covers saved transactions through the versioned application/persistence
path, with revision-safe navigation, dependent-feature restoration, replayable native export/copy,
and separate sketch draft shortcuts. Navigation lasts for the open project session and is bounded;
[ADR-0039](../adr/0039-committed-document-undo.md) defines the exact policy. The PR workflow now
includes the production browser build. The evidence table below tracks the current delivery state; dated sections retain each validation baseline.

Validation for this delivery passed: 1,561 unit tests across 189 files, full workspace typechecking,
formatting, lint, the changed-code Fallow audit, and the production browser build. One uninterrupted
Chromium/Firefox/WebKit run passed all 24 cases in `document-undo`, `document-history-recovery`,
`finished-sketch-features`, and `extrusion-compact`. The recovery cases cover damaged or missing
snapshots and imported undo journals; the long-journal fixture reads each of its 44 events once.
This focused evidence does not close the broader M0 workflow matrix or release performance gates.

The first implementation also exposed a remaining recovery/backup limitation: portable export
requires a valid stored head snapshot even if journal replay can reconstruct that head. Address
recovery-to-backup without requiring an unrelated new edit in M6. Installed-build update,
performance, and the larger workflow matrix remain release gates.

## Selected-edge delivery: 2026-09-05

The selected-edge portion of M2 now uses Fillet/Chamfer schema version 2, stable edge references,
graphical and keyboard selection, exact preview, and explicit repair when a target or topology
changes. Existing all-edge operations retain version 1 semantics. [ADR-0040](../adr/0040-selected-edge-treatments.md)
defines the limits and shared application/native boundary. Selected intent survives upstream dimension
edits, session undo/redo, reopening, and replay-validated native backup.

Final validation for this slice passed:

- `bun run test --maxWorkers=4`: 1,594 tests in 195 files;
- `bun run test:e2e tests/e2e/selected-edge-treatment.spec.ts tests/e2e/selected-edge-worker.spec.ts tests/e2e/edge-treatment.spec.ts tests/e2e/edge-treatment-worker.spec.ts tests/e2e/selected-edge-picking.spec.ts --workers=3`: all 21 cases in one Chromium/Firefox/WebKit run;
- `bun run typecheck`, `bun run format:check`, `bun run lint`, and `bun run fallow:audit`;
- `bun run build`, local Markdown links/language checks, and `git diff --check`.

The earlier concurrent unit/browser run timed out in the long undo-checkpoint fixture. The final full
unit run above was isolated from browser work and passed without changing the test timeout. The
production build still warns about large chunks and ineffective dynamic imports; performance work
remains an M6 gate.

This does not close M2: measurement queries/panel and constituent-body identity remain separate work.
M3/M4 still require the exact browser automation adapter, bounded inspection, pairing policy, and a
real MCP client round trip. The broader M0 baseline and M6 local-release gates remain open.

## Measurement delivery: 2026-09-07

The measurement portion of M2 now has a product task and the shared registered query
`org.vibeshape.model.measurements`. It reports exact committed volume, surface area, bounding dimensions,
and solid count per feature output, with project-unit conversion and bounded paging. Stale rebuilds,
failed features, malformed evidence, and construction-plane display geometry do not produce invented
measurements. Read-only projects can inspect metrics without a document mutation.
[ADR-0041](../adr/0041-revision-bound-model-measurements.md) owns the contract.

Validation passed:

- `bun run test --maxWorkers=4`: 1,625 tests in 198 files;
- `bun run test:e2e tests/e2e/model-measurements.spec.ts --workers=3`: all three browser projects;
- `bun run typecheck`, `bun run format:check`, `bun run lint`, and `bun run fallow:audit`;
- `bun run build`, documentation language/local-link checks, and `git diff --check`.

The first cold development-server run had Firefox module-loading failures during Vite dependency
preparation. Subsequent uninterrupted three-browser runs passed. The production build retains its
known chunk-size and dynamic-import warnings; this is not a release-performance certification.

The next delivery is M3: connect automation drafts to disposable exact worker preview and the existing
revision-safe persistence/undo path. Then M4 must prove a real paired local MCP client creating,
correcting, committing, and exporting a part. Constituent-body identity, the broader M0 workflow matrix,
M5 CAD operations, and M6 installation, recovery-to-backup, and performance gates remain open.

## Exact automation prerequisites: 2026-09-07

The host now requires a geometry port and returns preview schema version 2: semantic summary,
bounded exact measurements, and whole-draft validity. Commit recalculates and rejects failed or
blocked geometry even when the failing output is outside the response page. It rechecks the committed
base and expiry after asynchronous work. Managed drafts retain detached original commands so the next
adapter can call the ordinary persistent session instead of reconstructing commands from events.

The application owns fresh disposable workers with prompt cancellation, supersession, late-result
isolation, and final termination. The browser fixture exercises Box → impossible Fillet → correction,
validating native measurements, zero invalid commits, and five worker terminations. Its commit port
is in-memory; this is not browser persistence or a connected MCP client.

Prerequisite validation passed: 1,643 tests in 200 files, all workspace typechecks, Biome format/lint,
the changed-code Fallow audit, and the production build. The real-worker automation draft test passed
in Chromium, Firefox, and WebKit. Follow-up contract tests reject mixed-document/revision preview
views and await geometry entry before injecting revision/expiry races. Independent review found no
implementation defect in this prerequisite scope and confirmed that ordinary persistence integration
is still a required acceptance gate.

M3 remains open. Next connect retained commands to `PersistentDocumentSession.commitDraft`, validate
preview/commit intent before any write, publish the committed result to the editor, and prove one undo
transaction plus native reopen. Connect session cancellation/close and host-owned confirmation before
M4 transport exposure. [ADR-0042](../adr/0042-exact-automation-draft-application-path.md) remains proposed
until these application gates pass.

## Browser automation persistence: 2026-09-07

The trusted browser adapter now binds a host to the open project and commits its retained original
commands through `PersistentDocumentSession.commitDraft`. Redispatch must produce the exact expected
draft snapshot before any repository write. The ordinary versioned adapter saves one transaction,
records one undo checkpoint, and the controller publishes the committed geometry to the editor.
Writer-lease loss updates editor eligibility; an unexpected commit rejection releases the pending
save state and reports that persistence could not be confirmed.

Validation passed: 1,648 tests in 200 files; 18 browser cases in one uninterrupted Chromium, Firefox,
and WebKit run; full types, formatting, lint, Fallow, and production build. Native history, atomic
undo/redo, lease loss, stale revisions, unexpected persistence rejection, and late worker responses
are covered. Independent review found no remaining actionable issue after correcting prewrite lease
ordering. [ADR-0042](../adr/0042-exact-automation-draft-application-path.md) records commands and limits.

This closes the ordinary-persistence portion of M3.
The next slice at that point was host-owned review and confirmation bound to the exact draft and document revision.
Then M4 adds local pairing, transport, revocation/disconnection handling, and a real client round trip
through model creation, correction, commit, and export. The internal browser factory is not a connected
MCP endpoint and must not be advertised as one. ADR-0042 remains proposed until the remaining gates pass.

The next M3 slice must demonstrate:

- a browser review showing client identity, proposed changes, exact measurements, and the base
  revision, with explicit Apply and Discard actions;
- host-owned approval that clients cannot manufacture and that becomes invalid when the draft,
  committed revision, expiry, or owning session changes;
- invalid geometry and stale work blocked before approval or persistence, plus one ordinary undo
  transaction after an approved commit;
- browser evidence for approve, reject, revise-after-review, human-edit races, and session closure.

M0's broader CAD matrix, constituent-body identity, M5 CAD expansion, and M6 installation,
recovery-to-backup, and performance gates remain open.

## Browser review delivery: 2026-09-07

The host now requires an explicit trusted review port after exact geometry validation. The browser
presents proposed changes, common authored dimensions, bounded measurements, and client identity in
its responsive task panel. Destructive operations use the registered confirmation class. Approval
cannot be supplied by an MCP request, reused after an edit, or carried across sessions. The host
rechecks the base revision and expiry after the decision. Discard removes the owned draft.

Pending controls remain locked through persistence. Expiry, a human edit, or a session close cancels
review; its message remains dismissible. Closing just after Apply is separately guarded before the
ordinary commit begins. Once an atomic persistence operation has started, cancellation does not
promise rollback, and an unexpected save failure remains explicitly unconfirmed.

The next delivery is M4's real local MCP vertical slice. It must decide the loopback/browser authority
contract in ADR-0013, pair a client, advertise only supported commands, and prove create → exact
preview → human review → commit → viewport update → export. Disconnection, revocation, resource limits,
and progress/cancellation remain gates. Review currently summarizes semantic changes and metrics;
it is not a general visual geometry diff or complete topology inspection surface.

Validation passed: 1,668 tests in 202 files, all 33 cases in the uninterrupted three-browser automation
matrix, full typechecks, Biome, Fallow, and the production build. The browser matrix now uses the real
review buttons before ordinary commits and covers closing the session just after Apply. Detailed
commands, initial fixture correction, and remaining gates are recorded in ADR-0042.

## Local MCP vertical slice: 2026-09-07

The first M4 slice now connects an actual stdio MCP client to the production editor served from a
stable loopback origin. Explicit browser pairing opens one document; nine named tools support model
information, drafts, box creation, all-edge fillet creation/correction, exact preview, browser review,
ordinary commit, discard, and bounded STEP/STL/3MF resources. The real client scenario repairs an
invalid fillet, commits through the existing browser session, observes the result, navigates Undo/Redo,
and exports STEP. Client abort/close and UI Disable revoke access; credentials and export links are
memory-only. [ADR-0043](../adr/0043-local-stdio-mcp-browser-session.md) accepts this reduced transport
scope. ADR-0042's browser application path is now accepted; broader ADR-0013 extension policy remains proposed.

Verification: 1,695 unit tests passed. The final affected browser matrix passed all 54 cases across
Chromium, Firefox, and WebKit, including real stdio clients and compact/light/dark visual review.
Typechecks, lint, formatting, production build, and frozen dependency installation passed.

This is not full MCP coverage. Next expose existing sketch, Extrude/Revolve, Chamfer/selected-edge
repair, and variable workflows with matching inspection and command-specific tests. Add paged model
inspection and durable tool-name provenance. Then return to M5 part features and M6 installation,
recovery-to-backup, offline updates, and performance. Constituent-body identity and the broader M0
CAD workflow matrix remain open. The measurement/review surface is still a bounded summary rather
than a full proposed geometry overlay.

The MCP SDK is pinned at 1.30.0 in the server workspace only. Its audit exposed `qs` and `fast-uri`
transitive advisories; compatible overrides now resolve 6.16.0 and 3.1.6. The repeated dependency
audit reports no known vulnerabilities. Fallow identifies those overrides as unused because its
check expects pnpm metadata; the Bun lockfile confirms both resolved transitive dependencies.

## CAD authoring and inspection expansion: 2026-09-07

The local MCP adapter now exposes seventeen tools. Six additions create and update sketches,
Extrude, and Revolve through existing registered handlers; two additions read bounded model-tree
pages and full authored feature/sketch records at an exact committed revision. Single/multi-profile
parameters retain ordinary New/Add/Remove/Intersect semantics and existing axis/reference contracts.
The real-client scenarios exercise invalid-profile repair, inspection before editing, dependent
sketch rebuilds, exact volume checks, browser Apply, Undo, and reload.
[ADR-0044](../adr/0044-local-mcp-cad-authoring-and-inspection.md) records the contract and verification gate.

Verification passed: 1,711 unit tests with four workers, the full affected 60-case browser matrix
across Chromium/Firefox/WebKit, typechecks, lint, formatting, build, and the changed-code audit
(the same two investigated Bun override warnings remain). Discovery schemas use local references,
reducing their measured serialized size by 39% while retaining all supported parameter alternatives.

The next exposed workflows are Chamfer, selected-edge repair, variables, and remaining existing
primitive/boolean/reference commands. More detailed topology/profile and draft inspection,
large-record paging, durable tool provenance, M5 part features, and M6 release work remain open.

## Variable and Chamfer expansion: 2026-09-07

The local MCP adapter now exposes twenty-five tools. Five additions create, edit, rename, remove,
and atomically replace variables; one reads bounded committed definitions and evaluated values at
an exact revision. Two additions create/edit all-edge Chamfer. Fillet and Chamfer accept optional
variable expressions for their size, with ordinary domain resolution and exact worker validation.
[ADR-0045](../adr/0045-local-mcp-variables-and-chamfer.md) records the contract and verification gate.

Verification passed: 1,723 unit tests in 215 files, all 63 affected browser cases in one
Chromium/Firefox/WebKit run, workspace typechecks, formatting, lint, build and the changed-code audit.
After simplifying variable page projection, the owning 19 query tests and package typecheck passed
again. The two known Bun override warnings and ordinary-build performance gates remain unchanged.

Selected-edge reference inspection and repair are next. Remaining primitive/boolean/reference tools,
draft inspection, durable tool provenance, constituent-body identity, broader CAD workflows and
release gates remain open. This delivery does not complete the approved development plan.


## Selected-edge MCP expansion: 2026-09-07

The local adapter now has twenty-six tools. `model_edges` reads a bounded edge page at the exact
committed revision and rebuild, while existing Fillet/Chamfer commands accept selected references.
The UI and MCP share durable reference projection. Whole-set uniqueness, exact edge-count coverage,
explicit ambiguity, rebuild-bound cursors and typed stale/failure results prevent silent retargeting
or partial catalogs. [ADR-0046](../adr/0046-local-mcp-selected-edge-inspection.md) owns the contract.

Verification passed: 1,749 unit tests in 217 files, all 90 affected browser cases in one
Chromium/Firefox/WebKit run, workspace types, formatting, lint, build and changed-code audit. The
browser matrix includes ordinary graphical selection, upstream edits, Undo, reopening and native
backup as well as real MCP selected-edge authoring and repair. Known Bun override and build-size
warnings remain; this does not certify the broader CAD or release performance gates.

At this checkpoint, edge inspection required committed source geometry. The following delivery
removes that restriction for draft edges; remaining primitive/boolean/reference tools,
constituent-body identity, tool provenance, M5 part features and M6 release gates remain open.


## Draft inspection expansion: 2026-09-07

The local adapter exposes thirty tools. `draft_tree`, `draft_entity`, `draft_variables` and
`draft_edges` inspect owned unsaved intent at an exact draft revision. A client can create source
geometry, inspect its edges, repair selected treatments and submit the whole part for one browser
Apply. One Undo transaction restores the pre-draft document, including its variable table.
[ADR-0047](../adr/0047-local-mcp-draft-inspection.md) records the contract and verification gate.

Semantic reads do not rebuild geometry or renew expiration. Edge paging retains one detached,
validated catalog per host (4 MiB maximum) and releases each worker. Source edges remain available
when a downstream feature fails. Stale bases, expired owners, invalid evidence and invalidated
cursors fail explicitly. The host rechecks the committed base and expiration around asynchronous
work; the broker independently correlates draft responses.

Verification passed: 1,779 unit tests in 220 files, all 96 affected browser cases in one final
Chromium/Firefox/WebKit run, workspace types, formatting, lint, build and changed-code audit.
Independent owner review found no actionable issues. Three initial browser timeouts were traced to
five-second waits for asynchronous opening/review/reload; the targeted waits now use readiness
assertions with a 30-second limit. The complete final run passed without parallel verification load.
Known Bun override and production bundle warnings remain release work.

Next, close the remaining M0 sketch/Extrude/Revolve/face-selection/compact-layout baseline before
expanding everyday CAD coverage. Profile/face inspection, remaining named CAD commands, constituent
bodies, tool provenance and local release gates remain open; this delivery does not complete the plan.

## M0 workflow baseline delivery: 2026-09-07

The baseline investigation reproduced and repaired three runtime boundaries:

- Sketch support health now removes worker-only `edgePolyline` display evidence before strict
  domain topology validation. Previously, opening a face-supported sketch could throw instead of
  reporting resolved, missing or ambiguous support. Three regression fixtures use schema-valid
  worker candidates and retain strict domain validation.
- Asynchronous feature completion is bound to the initiating tool generation. A late cylinder save
  cannot close a newer sketch edit or a reopened feature task. Ordering tests reproduce both races.
- Cancelling a feature preview terminates its disposable worker. Late completion/rejection cannot
  update a newer preview. Repeated local MCP disconnection/disposal also leaves an already
  disconnected UI snapshot unchanged, without suppressing real disconnect or error transitions.

The reproduced cap-picking failure was a test readiness defect: its trace showed the Extrude form,
axial handle and non-selectable preview still active at the click. A rendered feature count includes
preview meshes. The fixture now waits for the form to close and preview status to become idle before
picking committed geometry. The older isolated retry remains historical evidence, not proof of a
kernel or raycasting defect. Another stale assertion expected Extrude to be disabled with eligible
saved profiles; the accepted workflow opens a profile picker instead.

The required [CAD workflow baseline](../testing-strategy.md#cad-workflow-baseline-gate) now covers 93
cases across Chromium, Firefox and WebKit, including invalid Extrude creation/edit, zero committed
features with no preselection, support replacement and compact sketch controls. The long sketch
authoring/edit/reload scenario has an explicit 120-second overall budget; the previous 30-second
total expired during reload after earlier assertions had passed. Production build is already in
PR CI, and the browser baseline is now explicitly required local evidence before merge.

M0 is complete. Final verification passed: all 93 browser cases in one uninterrupted three-browser
run (8.4 minutes), 1,787 unit tests in 220 files, workspace types, formatting, lint, production build
and changed-code Fallow audit. Independent owner review found no actionable issues. The final unit
and browser runs were isolated from other verification load. This proves the selected workflow
baseline, not product-wide browser coverage or release performance.

Local evidence is retained in `.artifacts/m0-browser-complete.log`,
`.artifacts/m0-unit-isolated-final.log` and `.artifacts/m0-source-final.json`. The source manifest
records SHA-256 digests of the uncommitted working tree over base `83405e84b391`; no source changed
during the final browser run. Failed diagnostic traces remain in `.artifacts/m0-wire-boundary-before`,
`.artifacts/m0-browser-intermediate-results` and `.artifacts/m0-cap-before-results`. A prior unit run
exceeded a five-second large-picker test limit under concurrent checks; the unchanged test passed
in the complete isolated run. Known bundle-size and Bun-override audit warnings remain release work.

At this M0 checkpoint, the M5 sketch-point Hole slice was in progress under
[ADR-0048](../adr/0048-sketch-point-holes.md). Its domain, sketch preparation, and geometry-worker
foundation is registered. Graphical/keyboard authoring, editing, named MCP tools, and the complete
undo/native/export workflow gates remain open. The remaining inspection/command parity and local
release gates also remain open. This delivery does not complete the overall CAD/MCP plan.

## Hole foundation update: 2026-09-07

The first M5 increment registers stable sketch-point Hole intent, variable-aware diameter/depth,
target/support dependency rules, solved-center preparation, UUID-independent content identity,
and single-solid cylinder cuts. Directional through-all starts at the selected point rather than
extending behind the sketch plane. Each center must remove material; invalid, empty, and split
outputs preserve the source. Intermediate geometry has explicit ownership and cleanup.

The oblique Hole regression also corrected whole-shape measurement: external dimensions now use
analytical OCCT bounds with shape tolerance rather than an oversized general bounding box. This
improves the existing measurement read model without changing persistent topology identities.

The final unit run passed 1,825 tests across 225 files, including graph, scheduling, solver failure,
content identity, and schema regressions. Full workspace types and the changed-code audit passed;
the latter retains only the two previously documented dependency-override warnings. One uninterrupted
Chromium/Firefox/WebKit run passed all 18 cases in `hole-worker`, `geometry-worker`,
`edge-treatment-worker`, `finished-sketch-features`, and `model-measurements`, including the oblique
bounds regression. The production build also passed. Remaining product gates are tracked in
[ADR-0048](../adr/0048-sketch-point-holes.md).

The next increment must expose graphical and keyboard point selection, explicit target selection,
diameter/depth expressions, extent and direction, exact preview, Apply/Cancel, and edit. It must then
add named `create_hole` / `update_hole` tools over ordinary drafts and prove sketch/variable updates,
commit/undo, native reopen, and export. These gates are required before moving the product Hole
capability to delivered or proceeding to solid patterns.

## Hole delivery update: 2026-09-07

The Hole UI and named MCP tools now use the production feature, preview, persistence, and export
paths. Graphical/keyboard point selection, edit and explicit missing-point repair, support-reference
retention, variables, sketch-dimension rebuilds, committed undo/redo, and native backup/reopen are
implemented. The full unit suite passes 1,846 tests in 228 files; the 39-case cross-browser Hole,
MCP, edge-selection, export, geometry, and measurement run passes. A further six-case run verifies
both compact themes, reduced motion, and native reopen. The mandatory M0 baseline passes all 93
cases in one isolated 8.2-minute Chromium/Firefox/WebKit run without retries. Workspace types,
formatting/lint, production build, and the changed-code audit pass; known bundle-size and two
Bun-override warnings remain release work. The first Hole slice is delivered. See
[ADR-0048](../adr/0048-sketch-point-holes.md)
for the precise contract, delivery evidence, and remaining Hole variants.

The next M5 increment is linear/circular solid patterns. Define durable
constituent-body and instance ownership before implementing independently selectable, spaced
copies. A pattern restricted to overlapping fused copies is not a substitute for that workflow.
The body/instance reference, seed inclusion, source consumption, transform expressions, and
atomic failure rules need a focused ADR before geometry or schema changes. Keep the existing
Part Design, document-worker, UI task, persistence, and MCP owners; do not add a second modeling
path. Current geometry, native cache lookup, measurements, and terminal-body projection are keyed
by whole feature output. A displayed instance role alone cannot make a copy a safe downstream
target: that role must also bind exact native-shape resolution, participate in dependency content
identity, and drive constituent-level consumption. Never derive it from OCCT solid enumeration.
The remaining inspection parity and M6 recovery/install/offline/performance gates remain in the
approved scope.

## Constituent-body foundation: 2026-09-07

[ADR-0049](../adr/0049-constituent-body-identity-and-solid-patterns.md) defines the staged body and
pattern contract. Geometry protocol 14 and canonical identity version 1 now bind a named body role
to its exact dependency hash, including the direct document-worker engine path. Legacy version 0
identity remains unchanged. Single-solid producers declare `result`; multi-solid aggregates receive
no inferred constituent identity. The native registry tracks root and named-output ownership,
invalidates partially retired entries, and retries only failed deletions. Dependency availability is
checked before reusing a cached downstream result.

The next implementation slice has added Hole version 2 body selectors, role-preserving rebuild
identity, derived body catalogs (geometry protocol 15 / document protocol 20), and constituent-level
export projection. Versioned commands and native project files preserve the selected role. Exports
retain unconsumed siblings and verify both feature and body identity for 3MF; worker transfers clone
complete catalogs and deduplicate aliased mesh buffers. Old Hole versions and unnamed multi-solid
aggregates keep their previous semantics.

The viewport, body tree, and preview now adopt terminal-body projection and exact role selection.
A synthetic two-body fixture exercises the real renderer and tree; it does not establish a native
pattern producer. The subsequent measurement increment adds exact-role metrics in the editor and
the read-only local MCP tool `model_body_measurements`, preserving old whole-feature query clients.
Stage 2 remains open: per-copy topology and explicit repair still need body-level adoption.
The next slice must complete those consumers before enabling an
independently selectable linear pattern and its UI/MCP workflow. Pattern mesh-memory
budgets also remain open. Circular patterns follow on the same ownership contract; the rest of M5
and M6 remain in scope. Neither native role lookup nor persisted selectors alone deliver a pattern
command.

The regression run also exposed an export-dialog startup race: the trigger was enabled while the
local document was still opening, and initial session replacement dismissed the dialog. The trigger
now waits for a ready active document. Empty opened documents still show the no-solid explanation.

Stage 1 verification passes 1,872 unit tests in 231 files and all 30 affected browser cases in one
uninterrupted Chromium/Firefox/WebKit run after the startup-race fix. Types, formatting/lint, the
changed-code audit, and the production build pass. Known bundle warnings and the two dependency
override warnings remain M6 work. See ADR-0049 for exact evidence and the still-open product gates.

The subsequent selector/catalog increment passes 1,893 tests in 234 files, all workspace types,
formatting/lint, the changed-code audit, the production build, and all 30 cases in the same affected
three-browser matrix. The new native Hole v2 case checks volume, root/catalog identity and stable
ownership. See ADR-0049 for the fixture correction and remaining Stage 2 gates.


The 2026-09-08 display increment passes 1,913 tests in 235 files, full workspace types, formatting,
lint, Fallow, and the production build. A 30-case three-browser workflow run and a subsequent
15-case body/selected-edge run both pass; six body cases are repeated between runs. Exact commands,
startup-race fixes, fixture corrections, visual evidence, and remaining gates are recorded in
[ADR-0049](../adr/0049-constituent-body-identity-and-solid-patterns.md).

## Recommendation

The 2026-09-08 body measurement increment passes 1,938 unit tests in 240 files and all 24 cases in
one uninterrupted Chromium/Firefox/WebKit run of measurement, paired MCP, native body ownership,
selection, and export workflows. Full types, formatting/lint, Fallow, and the production build pass
with the focused final corrections described in [ADR-0050](../adr/0050-constituent-body-measurements.md).
Per-copy topology and explicit repair remain the next Stage 2 work before independent patterns.

Deliver a dependable parametric part editor, then expose its supported workflows through MCP.
Prioritize committed undo/redo, stable geometry selection, selected-edge treatments, and exact
automation feedback. Build the first MCP vertical slice before attempting complete CAD parity.
Assemblies, drawings, collaboration, and a public extension SDK are separate later milestones.

The user's selected capability priority remains CAD expansion. Selected-edge Fillet and Chamfer
and the measurement panel are now delivered. Revolve already exists and needs continued workflow
coverage. Preserve the implemented shared automation application path and continue M5's ordered
CAD expansion through constituent topology/repair, then independent linear and circular patterns.

## Evidence and limitations

The original audit was based on source and existing evidence. Subsequent focused delivery runs are
recorded above; they do not constitute a complete browser, performance, or release certification.
Earlier focused browser checks covered the finished-sketch and compact-panel fixes. The earlier
full extrusion run passed 14 of 15 cases; its face-picking failure passed in isolation. That retry
does not establish uninterrupted suite stability. Previously fixed test labels and helpers are not
counted as unresolved product defects.

| Area | Current evidence | Remaining bottleneck |
| --- | --- | --- |
| Modeling | Registered Box, Cylinder, Boolean/Subtract, Extrude, Revolve, Datum Plane, Fillet, Chamfer, and sketch-point Hole; sketch-driven New/Add/Remove/Intersect workflows | No production solid pattern, mirror, shell, sweep, or loft |
| Edge treatments | Exact all-edge and selected-edge preview, edit, persistence, native reopen, and explicit repair | Broader topology and constituent-body selection remain incomplete |
| Undo | Sketch draft navigation and committed session transaction undo/redo, including atomic automation drafts | Navigation stacks intentionally end with the open project session; broader workflow coverage remains |
| Selection | Stable references and conservative resolution for supported geometry; exact constituent roles in viewport/tree selection and dependent body selectors | Per-copy topology and explicit constituent reference repair remain incomplete |
| Automation | Validated commands, owner-bound drafts, exact disposable geometry, trusted browser persistence integration, and local stdio pairing with thirty-three tools | Full CAD command/resource coverage and release conformance remain open |
| Inspection | Revision-bound exact feature/body measurements, shared bounded queries, and an editor measurement panel; exact body measurements exposed through local MCP | Broader model/topology/diagnostic inspection remains incomplete |
| Local storage | Transactional semantic commits, recovery, project library, and native backup/import exist | Draft recovery policy, backup reminders, restore UX, ownership communication, and installed-build update validation remain |
| Import and printing | STEP/STL/3MF export and slicer handoff exist; STEP import is exercised below the product workflow | Product STEP import is absent; `print-analysis` is a scaffold, not a printability report |
| Verification | PR CI runs formatting, lint, types, unit tests, dependency audit, Fallow, and production build | Full browser workflow and installed-build release gates remain open |

Primary source anchors:

- [Feature registry](../../packages/domain/src/modules.ts),
  [all-edge treatment decision](../adr/0038-all-edge-fillet-and-chamfer.md), and
  [topology contracts](../../packages/domain/src/topology.ts).
- [Editor action wiring](../../apps/web/src/app.tsx),
  [automation host](../../packages/automation-host/src/host.ts), and
  [automation queries](../../packages/automation-api/src/queries.ts).
- [Geometry engine](../../packages/geometry-worker/src/engine.ts),
  [print-analysis scaffold](../../packages/print-analysis/src/index.ts), and
  [PR workflow](../../.github/workflows/ci.yml).
- [Storage architecture](../architecture/local-first-storage.md) and
  [automation architecture](../architecture/automation-and-mcp.md).

The large viewport/task files and recorded build sizes are maintenance and performance risks,
not proof of runtime failure. The previous build reported approximately 2.26 MB of minified
JavaScript and 10.9 MB of WASM. Measure cold start, memory, and rebuild latency on the ordinary
production build before setting optimization priorities. Controlled OCCT spike timings do not
certify that build: the controlled package currently requires a separate Vite mode.

## Delivery sequence

Effort is intentionally not expressed as calendar dates. Each stage ends in observable behavior
and regression evidence. Start with M0 and M1; investigate M2 references and M3 query contracts in
parallel where ownership is disjoint. M4 does not depend on completing M5.

| Stage | Priority and dependencies | Scope and owner | Exit criteria |
| --- | --- | --- | --- |
| M0: dependable workflow baseline | Completed 2026-09-07 | Web command eligibility, task lifecycle, browser fixtures, release checks | One uninterrupted target-browser run covers sketch creation/finish, Extrude/Revolve with and without preselection, preview, Apply/Cancel, invalid input, edit, reload, and compact layouts. Capture face-picking failure evidence and resolve its cause. Add a production build gate and either a short browser CI gate or explicit required local browser evidence. Keep native interoperability spikes local. |
| M1: committed undo/redo | P0; M0 baseline | Domain transaction/history semantics, application actions, persistence | Create/edit/delete and variable changes each have the intended undo boundary. A multi-command automation commit is one undo step. Redo truncates after a new edit. Rebuild and persistence remain atomic; tests cover dependent features, failure, reload, and project switching. Define and document whether undo stacks survive restart. |
| M2: geometry selection and useful CAD editing | P1; M0, shared transaction contract from M1 | Domain topology/body contracts, worker resolution, existing web selection and part-design owners | Select specific edges for Fillet/Chamfer, preview only that selection, save/reopen it, and change upstream dimensions. Missing or ambiguous references are visible and repairable without silent retargeting. Add a minimal durable body identity only where constituent-body targeting requires it; migrate existing files and retain all-edge feature behavior. Add a measurement panel backed by the same bounded queries used by automation. |
| M3: exact automation application path | P1; M1; use existing stable selectors first | Existing automation API/host plus browser application adapter and geometry coordinator | A validated draft rebuilds with the real worker, returns exact measurements and structured diagnostics, and commits through the active document's ordinary persistence/revision path. The trusted browser adapter now binds the host to the open persistent session and requires host-owned review before writing. Preserve the current history authority. Invalid, stale, cancelled, or expired work cannot overwrite a newer model. |
| M4: first useful local MCP | P1; M3 and explicit ADR-0013 decision | Thin local transport plus existing browser host | A real MCP client discovers supported tools, reads a model, creates a draft, previews it, corrects a geometry error, commits, observes the viewport update, and exports a part. Pairing, revocation, disconnected-browser behavior, request limits, and permitted actions are covered. One launch path serves the app at a stable loopback origin and connects the client. |
| M5: everyday part coverage | P2; M1/M2; ship individual slices | Existing domain feature registry, worker evaluation, cohesive web feature modules | Parameterized holes, linear/circular solid patterns, mirror/transform, and richer extrusion extents each ship with edit, preview, variables, dependencies, undo, persistence, export, and MCP exposure. Add shell, then sweep/loft after reference and profile contracts support them. Product STEP import follows a durable imported-asset/body ownership decision. |
| M6: reliable local release | P1 before a release claim; can begin alongside M2-M4 | Application lifecycle, storage, build/distribution, performance | Install/start/reopen works without development tooling assumptions. Test two-build upgrades, offline reopen, worker crash recovery, lease loss/takeover, backup/restore, and unavailable OPFS. Measure ordinary-build startup, preview/rebuild latency, and memory on named devices and fixtures. Promote the controlled OCCT artifact only through its remaining review and release gates. |

M2 should not grow into an assembly system. Begin with explicit identities and selectors required
by current part operations. Split oversized web components along task lifecycle, selection,
sketch interaction, and presentation ownership as those workflows change; avoid a repository-wide
rewrite or a package for every toolbar button.

Committed edits already use durable transactions. M6's recovery work concerns interrupted
drafts, ownership, backups outside browser-origin storage, and application updates; it must not
be presented as fixing an absence of document saving.

## What complete MCP means for the first release

Coverage means parity with **supported product capabilities**, not a promise that unimplemented
CAD operations can be invoked. Publish a versioned capability matrix with limits and stable IDs.
Transport must delegate to ordinary registered queries and command/draft handling.

| Surface | Required behavior |
| --- | --- |
| Discover | List available operations, schema versions, units, limits, and current session permissions |
| Inspect | Read document revision, variables, sketches/profiles, feature history, selectable bodies/topology, measurements, and structured failures through bounded queries |
| Model | Create and modify supported sketches, constraints, variables, and features; resolve references from query results rather than transient OCCT indices |
| Draft | Create, apply commands, run exact preview, inspect failure, correct, cancel/discard, and atomically commit against an expected revision |
| History | Use the same undo boundary as UI work; apply the decided session policy to undo/redo and destructive actions |
| Export | Produce revision-specific STEP/STL/3MF through the ordinary export path with explicit output handling |
| Observe | Report execution identity, progress, terminal status, and cancellation; reject late results after cancellation or a newer revision |

The implemented first transport is a Bun stdio bridge serving the static application at a stable
loopback origin, with an explicitly paired browser session retaining document authority.
[ADR-0043](../adr/0043-local-stdio-mcp-browser-session.md) accepts this reduced subset of ADR-0013;
the broader module/extension proposal remains open. A closed
browser produces a clear unavailable-session result. Headless geometry is a separate later
architecture decision. Do not expose arbitrary script execution, raw kernel handles, or direct
IndexedDB mutation as modeling tools.

Start with supported primitives and sketch/extrude workflows; add selected-edge treatment tools
after M2. Print-analysis resources are not a dependency of this first useful automation loop.

## Acceptance models

1. **Mounting bracket:** variable-driven sketch, Extrude, Remove, and selected-edge treatments;
   change an upstream dimension, inspect volume/bounds, undo/redo, reopen, and export. Add the
   dedicated Hole and Pattern variants when M5 delivers them.
2. **Turned bushing:** constrained profile, Revolve, bore/cut, and Chamfer; verify axis selection,
   regeneration after dimension changes, and export geometry.
3. **Multiple bodies:** create two independent bodies, target only the intended one, preserve the
   other through edits and reload, and export the intended set.
4. **Automation recovery:** create a bracket draft, reject invalid geometry, retain the last good
   model, correct and commit once, reject a stale revision, and cancel without late application.
5. **Release recovery:** reopen an existing project after an application upgrade and worker crash;
   restore an exported native backup into a fresh project without changing the original.
6. **Later coverage:** a shelled enclosure and a STEP reference part validate M5's additional
   operations and import ownership once those capabilities exist.

Tests must check geometry invariants and durable state as well as visible buttons. Use the
appropriate browser matrix for interaction changes and independent format interoperability for
export changes. A successful screenshot, build, or isolated retry is not sufficient alone.

## Immediate implementation backlog

1. Completed: the M0 baseline passed all 93 cases in one three-browser run. Preserve its required
   local gate and the recorded support, completion-ownership, preview-lifetime and picking evidence.
2. Completed: committed session undo semantics, create/edit/delete/variable navigation, and
   replay-validated persistence/recovery evidence under ADR-0039.
3. Completed: versioned selected-edge intent, Fillet/Chamfer picking and explicit repair under
   ADR-0040. Feature and constituent-body measurement queries and the inspection panel are
   implemented. Preserve exact body identity as additional consumers adopt it.
4. Exact draft preview, bounded measurements, browser review, and ordinary persistence/undo are
   implemented. Preserve their original-command replay, revision, lease, cancellation, and private
   worker invariants when extending MCP. Match each advertised command to the inspection and
   confirmation details the browser can actually present.
5. Draft tree/entity/variable/edge inspection is implemented. Extend it with profile/face
   inspection and remaining existing CAD commands. Add matching inspection, browser review,
   and real-client recovery cases for each exposed workflow.
6. Completed: sketch-point Hole with preview, edit, variables, Undo, reopen, export, and named MCP
   create/update tools under ADR-0048. Preserve its exact role selector and existing version behavior.
7. Complete ADR-0049 Stage 2 with body-bound topology and explicit reference repair. Measurements,
   rendering, selection, and export now share exact body identity. Then deliver independently
   selectable linear patterns with bounded native mesh memory and complete UI/MCP workflows;
   reuse that contract for circular patterns. Continue the remaining M5 and M6 gates afterward.

Keep the feature matrix and architecture status synchronized as each stage lands. Existing
overview and roadmap passages mix spike-era work with newer production features; reconcile their
history/protocol and multi-profile status during the relevant stage, without rewriting accepted
ADRs retroactively. Do not interpret the older roadmap's week ranges as current estimates.

## Deferred scope

Assemblies and mates, engineering drawings, advanced surfacing, simulation, cloud collaboration,
public third-party execution, and independent headless modeling are outside the first local
part-modeling/MCP release. They need separate scope and acceptance plans. Completing this plan
would establish a useful local parametric CAD application with automation, not full Onshape parity.
