# ADR-0049: Constituent body identity and solid patterns

- Status: Accepted architecture; staged implementation, product gates open
- Date: 2026-09-07
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md), [ADR-0034](0034-versioned-multi-profile-feature-input.md)

## Context

Linear and circular patterns must produce spaced copies that remain independently selectable and
modifiable. The current feature cache, terminal-body projection, measurements, and export traversal
address a whole feature result. A display label cannot select one exact native solid, and selecting
two copies must not produce the same downstream content identity. OCCT enumeration order cannot
provide persistent constituent identity.

## Decision

Extend the existing Part Design, domain content identity, application rebuild, geometry worker,
and editor owners. MCP remains an adapter over ordinary document commands and disposable drafts.
No second modeling path or new package is required.

A body reference identifies its producing feature and a bounded semantic output role. The exact
source content hash binds its transient native resolution. The role is authored by the feature's
semantics, never by OCCT solid, face, edge, or tessellation order. `result` denotes an entire result
that is exactly one solid. Legacy aggregates containing several solids do not acquire constituent
names automatically, even if their enumeration happens to be repeatable.

Native cache entries retain the aggregate result and an explicit map of owned constituent shapes.
An omitted role keeps the existing whole-result lookup. A supplied role resolves only that exact
role at the requested document, feature, and hash; missing roles never fall back to the aggregate.
Each native wrapper has one owner. Root/constituent aliases are deleted once. Replacement validates
the incoming bundle before changing ownership. Cleanup failure makes the old bundle unavailable;
failed deletions remain tracked for recovery, while successfully deleted wrappers are never retried.
An incoming bundle is not published when retiring the old one fails.

Canonical content identity version 0 remains unchanged. Version 1 adds a required, ordered
`feature.inputRoles` array alongside the existing dependency hashes. Each slot is either `null`
(whole result) or one normalized output role; at least one slot must name a role. UUIDs still do
not participate in input identity. The geometry protocol independently verifies both the role and
hash of every evaluation dependency before resolving native shapes, including cache hits.
Geometry protocol version 14 carries this contract. These are derived evaluation contracts;
existing persisted feature versions and native project files are not rewritten.

Persisted constituent targeting must be introduced through explicit feature type versions, with
selectors projected into those canonical input slots. The unique-feature DAG remains a scheduling
graph; it must not be overloaded with duplicate feature IDs to represent different bodies. A future
operation needing several bodies from one feature requires explicit body input slots separate from
the deduplicated scheduling dependencies. Until that extension is implemented, it fails closed.

### Pattern semantics

The first pattern feature selects one exact single-solid source body and owns all its outputs,
including the seed. Count includes the seed, is an integer from 2 through 256, and may use a
dimensionless expression. `pattern.instance.0` is the seed; the remaining roles are deterministic
authored repetition ordinals. Changing spacing or angle preserves those roles. Reducing count
removes the affected roles and breaks downstream references explicitly; it never substitutes a
different copy. Undo or restoring count restores the same semantic roles.

Linear patterns use a normalized world direction and a positive length expression for adjacent
instance spacing. Circular patterns use an explicit axis and either a full revolution, with step
`2*pi/count`, or a positive adjacent-instance angle whose last instance is strictly below one full
revolution. Axis and direction preparation belongs to the document worker. The first authoring
slice uses immutable origin axes; richer datum and model-edge selectors need their own tested
reference preparation. No viewport camera state defines modeling intent.

Copies remain separate owned solids. They are not fused, even when touching or overlapping.
Every copy must be a valid positive-volume solid, within coordinate and resource budgets. A failed
transform, missing source, invalid expression, or invalid copy fails the complete evaluation and
disposes all temporary copies. Partial arrays are never committed or cached.

The pattern consumes only its selected source body. A later modifying operation consumes only the
selected instance and leaves its siblings terminal. Terminal-body projection, per-body mesh and
topology selection, measurements, and STEP/STL/3MF export must use this same constituent ownership.
Topology references on a copy must bind its body role as well as their face or edge semantics.
Whole-feature consumption must not silently hide unmodified siblings.

## Staged delivery and required evidence

1. Exact native role lookup and ownership; role-sensitive canonical identity and independent worker
   validation. Exercise existing single-solid results through `result`, preserve legacy whole-result
   behavior, reject unknown and stale roles, and prove native cleanup with real worker evidence.
2. Versioned persisted body selectors and constituent-level terminal projection. Prove downstream
   targeting, topology isolation, sibling preservation, rebuild, suppression, and explicit repair.
3. Linear pattern evaluation and complete create/edit/preview/Apply/Cancel flow, with named MCP tools
   using the same commands. Prove count/spacing expressions, source edits, independent selection,
   downstream Hole/Fillet/Chamfer, undo/redo, native reopen, and all three export formats.
4. Circular pattern on the same contracts, including full-circle and partial-angle bounds, reversed
   axes, count changes, and the same product and automation gates.

Stage 1 is a prerequisite, not delivery of the pattern feature. Existing multi-profile aggregates
remain whole-result-only until a producer can prove semantic constituent ownership. Assemblies,
feature patterns that replay modeling operations, and arbitrary compound splitting are outside
this first solid-pattern contract.

## Stage 1 evidence: 2026-09-07

The exact native role foundation is implemented. Domain tests prove role-sensitive canonical payloads,
UUID-independent input ordering, strict version dispatch, and unchanged whole-result identities.
The geometry transport and direct engine entry point share role/hash slot validation; direct-engine
failure tests prove that mismatched inputs never initialize the kernel or touch native ownership.
Registry tests cover explicit `result` declaration, no aggregate fallback, document/hash isolation,
duplicate roles and ownership rejection, partial cleanup, sibling cleanup, and retry without double
deletion. The production worker fixture proves named-result evaluation, cache reuse, stale-source
rejection before a cache hit, multi-solid aggregate rejection, unchanged source volume, stable owned
counts across replacement, complete disposal, and a clean worker restart.

Verification passed:

- `bun run test --maxWorkers=4`: 1,872 tests in 231 files, in one isolated 29.45-second final run.
- `bun run typecheck`, followed by owning geometry/web typechecks after their final edits.
- `bun run format:check`, `bun run lint`, and `bun run fallow:audit`; only the two previously recorded
  dependency-override warnings remain, with no new suppression.
- `bun run build`; the existing large-chunk and ineffective-dynamic-import warnings remain M6 work.
- One uninterrupted Chromium/Firefox/WebKit run of `body-output-worker`, `geometry-worker`,
  `hole-worker`, `selected-edge-worker`, `finished-sketch-features`, `document-export`, and
  `local-mcp-hole`: all 30 cases passed in 1.5 minutes, with three workers and no retries.

The first browser run passed 29 cases and exposed an export-dialog startup race in WebKit. Its trace
showed the enabled trigger during `Opening local document`, followed by the initial editor-session
replacement. The product trigger now waits for a ready active document. Four component regressions
cover unavailable states and the transition to an opened empty document; the complete 30-case browser
set was rerun after that fix. The failed trace is retained as diagnostic evidence.

These checks close Stage 1. They do not deliver pattern authoring, certify the full M0 workflow matrix
on this snapshot, or close the remaining constituent projection and product gates above.


## Stage 2 implementation increment: 2026-09-07

Hole feature version 2 now persists `targetBody: { schemaVersion: 0, featureId, outputRole }` through
ordinary versioned commands, event replay, and `.vshape` serialization. Version 1 remains registered.
The selected producer must equal the first dependency. Rebuild scheduling retains the authored role,
and domain identity rejects a dropped or substituted selector. Support on the same producer requires
`result`; a distinct support input remains whole-result. Both domain validation and the native Hole
parser reject incompatible support/body scopes.

Geometry protocol 15 adds optional derived body catalogs, emitted by the native engine on every
success. Single-solid results alias the root as `result`; Datum Planes and legacy aggregates expose
an empty catalog. Nonempty catalogs have at most 256 unique positive-volume single-solid entries and
cover every root solid. This does not establish a total mesh-memory budget for future patterns.
Document protocol 20 transfers the catalogs. Cloning full geometry and deduplicating shared root/body
buffers prevents detaching retained rebuild state.

The application terminal-body projection now consumes selected roles, and the document worker uses
it for STEP/STL/3MF export. Failed, suppressed, or empty-output consumers leave source bodies intact.
An unavailable selected role fails closed. Print-mesh responses must match both the feature ID and
output role, preventing same-producer siblings from being substituted during 3MF packaging.

This increment does not close Stage 2: the viewport, body tree, previews, measurements, topology
references, and explicit repair still need constituent-level adoption. No pattern producer, pattern
UI, or named pattern MCP command has been enabled. Existing single-result workflows remain the
native evidence target until independent-copy producers and their remaining consumers are ready.


Increment verification passed:

- `bun run test --maxWorkers=4`: 1,893 tests in 234 files, in a final isolated 28.68-second run.
- Full workspace `typecheck`, `format:check`, `lint`, and `fallow:audit`; no new suppression, and only
  the two previously recorded dependency-override warnings remain.
- Production build; the existing chunk-size and ineffective-dynamic-import warnings remain open.
- The same seven-spec Chromium/Firefox/WebKit set listed in Stage 1 passed all 30 cases, with three
  workers and no retries. The body-output fixture additionally proves Hole v2 volume, `result`
  catalog publication, unchanged source volume, four stable owned shapes, disposal, and restart.
- The initial browser run passed 27 cases and failed the new Hole v2 assertion in all three browsers.
  The fixture placed the hole on the XY corner and cut a quarter-cylinder while expecting a complete
  cylinder. Moving the center inside the block corrected the fixture; the complete 30-case set was
  rerun. This required no CAD runtime change. Initial and final evidence are retained separately.

The full M0 workflow matrix and the remaining Stage 2 product consumers have not been certified by
this increment.


## Stage 2 display and selection increment: 2026-09-08

The viewport, body tree, and exact preview now use the shared terminal-body projection. Viewer mesh,
raycast, face-selection, and highlight identity includes the declared output role as well as the
producer. Equal face IDs on siblings remain distinct. Named body rows activate exact bodies; History
rows continue to open feature tools. Unnamed legacy results retain their original identity.

Body selection is separate from face selection and active feature editing. Hiding a producer,
removing a role, clearing selection, or starting another feature tool releases the corresponding body
selection. Missing hover roles are cleared as well. Body previews preserve unchanged sibling styling
using the canonical producer content hash, which binds the full set of outputs. Unsupported
constituent face support cannot fall back to root topology: non-`result` roles are rejected, and the
explicit `result` alias must be declared. Body-bound topology authoring and repair are still pending.

The browser fixture supplies two synthetic body meshes to the real production viewport and tree.
It exercises distinct tree selection, hover, native pointer picking with identical face IDs, removal,
and background clearing. It is display evidence, not native pattern evaluation. Measurements,
per-copy topology and explicit repair remain Stage 2 gates; independent linear/circular producers,
full UI/MCP workflows, and bounded pattern mesh memory remain undelivered.

Increment verification passed:

- `bun run test --maxWorkers=4`: 1,913 tests in 235 files, in a final isolated 32.92-second run.
- Full workspace typechecks, formatting/lint, the changed-code Fallow audit, and the production
  build; final test-only edits also passed script typechecking and scoped Biome. The existing
  dependency-override and bundle warnings remain open, with no new suppression.
- One uninterrupted Chromium/Firefox/WebKit run of `body-selection`, `box-parameters`, `datum-plane`,
  `finished-sketch-features`, and `document-export`: all 30 cases passed in 1.9 minutes.
- A subsequent uninterrupted run of `body-selection`, `selected-edge-picking`, and
  `selected-edge-treatment`: all 15 cases passed in 1.2 minutes. This repeats six body-selection
  cases and adds nine selected-edge cases, including upstream changes, undo, reopen, repair, and
  native backup. Final dark/light screenshots were reviewed with transitions disabled.
- Documentation language/local-link checks and `git diff --check` passed.

Initial browser evidence exposed a real workspace-startup race: Variables could activate before
initial session replacement and then lose its panel. Variables and Origin now wait for a ready
controller, while ready read-only documents remain navigable. Review also caught body selection
masking a newly opened feature tool and stale hover surviving role removal; regressions cover both.

The display fixture required stable callbacks to avoid recreating its viewport on each selection.
Its hover assertion now leaves both pointer and keyboard focus before expecting hover to clear.
The existing Box workflow crosses three reloads and exceeded its 30-second whole-test budget at its
last reload; its explicit budget is now 60 seconds, with individual assertion timeouts unchanged.
The final complete browser set was rerun after these corrections. Earlier failure traces remain
separate from the passing evidence. This is not a certification of the full M0 or M6 release gates.

## Stage 2 measurement increment: 2026-09-08

[ADR-0050](0050-constituent-body-measurements.md) records the subsequent body measurement delivery.
The editor and read-only `model_body_measurements` MCP tool use the same terminal-body consumption
authority as rendering and export. Exact roles, historical queries, stale/missing-body diagnostics,
bounded pages, and legacy aggregate compatibility are implemented. The existing whole-feature
measurement query and preview contracts remain unchanged.

The increment passes 1,938 unit tests in 240 files and a 24-case three-browser matrix covering native
measurements, selection, exports, and real paired MCP inspection. See ADR-0050 for exact verification
and the broker/schema defects found and corrected during acceptance. Per-copy topology and explicit
repair still block completion of Stage 2; this increment does not introduce native pattern producers.

## Stage 2 Hole authoring increment: 2026-09-13

The product form and existing local MCP Hole tools now author the accepted v2 body-reference
contract. The form derives choices from validated current body measurements and terminal body
consumption, preserving unconsumed siblings and exact missing-target intent. Editing retains
legacy v1 unless a named target is selected; explicitly selecting a legacy whole-result target
emits v1. Cyclic targets are excluded, and same-producer sketch support rejects non-`result` roles.
MCP updates retain v2 only when the caller resubmits `parameters.targetBody`; omission explicitly
requests v1 semantics. Public tool schemas accept both variants without changing the tool count.

This increment adds no native pattern producer and does not complete Stage 2. Body-bound topology,
selected-edge inspection/repair, and pattern memory gates remain open. The current delivery and
verification record is in the [development plan](../product/local-cad-and-mcp-development-plan.md).
