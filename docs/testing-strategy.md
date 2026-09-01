# Testing strategy

## Principle

CAD cannot be validated with UI screenshots or byte-for-byte B-Rep comparison alone. Tests focus on **design intent, geometry invariants, formal validity, and independent round-trip behavior**.

## Test pyramid

| Level | Coverage | Tool or approach |
|---|---|---|
| Pure unit | Units, expressions, DAG, commands, migrations | Vitest through `bun run test` |
| Property-based | Parameter ranges, solver degeneracies, `TopoRef` | fast-check or equivalent |
| Worker contract | Schemas, revisions, cancellation, transfer buffers | Vitest through Bun plus real worker |
| Kernel fixture | Operations, validity, metrics, memory | Browser or Node-compatible WASM harness |
| Format conformance | `.vshape`, STEP, STL, 3MF | Validators and round-trip |
| Component | Tree, property editor, diagnostics | Testing Library |
| E2E | Complete CAD, print, offline, and recovery flows | Playwright |
| Manual release | Slicers, Safari, interaction quality | Release checklist |
| Extension conformance | Packages, capabilities, determinism, isolation, compatibility | `SPK-006` harness and browser E2E |
| Automation and MCP conformance | Resources, schemas, draft safety, pairing, consent, progress, cancellation | Contract tests, hostile loopback fixtures, and real MCP client E2E |

## Document dependency graph tests

The document graph requires deterministic pure tests for every durable relation between sketch and feature
nodes, exact History coverage, strict typed node references, duplicate and missing owners, self-reference,
forward-order failures, cross-kind cycles, deterministic independent-node ordering, and deduplicated
parent/child adjacency when two semantic relations share one node pair. Sketch and feature IDs are separate
typed namespaces even when their UUID text matches.

Command and event tests require the same graph validation after reduction, including missing cross-kind
sources, sketch-support/feature-profile cycles, tampered replay, and graph-owned deletion blockers. Legacy
schema-version-0 snapshots derive a deterministic transient topological order for that validation without
changing their persisted bytes. Before the graph becomes authoritative for reorder, dirty propagation,
persistence, or UI eligibility, tests must also cover unavailable feature dependency models and the
migration/replay matrix required by
[ADR-0026](adr/0026-document-dependency-graph-and-interleaved-history.md): complete legacy journal replay,
late snapshot plus suffix recovery, deterministic snapshot-derived fallback for snapshot-only or missing,
corrupt, and inconsistent journal prefixes, migration idempotence, interrupted persistence, document copy, and
`.vshape` canonical equality.

The pure domain portion of that matrix now covers complete replay-equivalent journals, remove-and-readd authored
order, dependency-safe stabilization, missing/corrupt/inconsistent journal fallback, built-in semantic-input
projection, unavailable extension declarations, strict version-0 compatibility, exact version-1 History coverage,
and byte-idempotent remigration. Application adoption, product-facing document copy, and `.vshape` switching remain
required before schema version 1 becomes the product default.

The local SPK-005 browser evidence additionally verifies the opt-in migrated recovery seam: a complete checksummed
prefix returns a schema-version-1 `journal-derived` snapshot, a corrupt earlier prefix returns successful explicit
`snapshot-derived` recovery with the owning event record, and both paths leave the stored version-0 payload
unchanged. A corrupt suffix separately proves that migration uses the actually recovered revision rather than the
project head. Canonical before/after checks cover the project record, every snapshot, every event, and the recovery
marker.

The same Chromium, Firefox, and WebKit corpus now promotes that recovered snapshot into the side-by-side v1 stores,
rejects a stale but schema-valid promotion candidate, refuses to adopt a legacy recovery with bounded loss, commits and replays a v1 rename, rejects a legacy write after
adoption, rejects lease, single-commit, and draft-commit mutation against a corrupt v1 head, recovers through a corrupt latest v1
snapshot, bounds loss after corrupting the matching suffix event, proves transaction rollback under a synthetic
quota failure, and verifies clean-close recovery. It also proves that all v1 activity leaves the complete v0
rollback source byte-canonical. The same browser stage verifies that the unified catalog reports the v1 name and
revision rather than the retained v0 head, accepts only an exact-v1-revision preview, and rejects a legacy preview
write after promotion without changing the current thumbnail. It also creates a v1-only project, copies the
source preview to its exact head, deletes the copy atomically, and verifies the event, snapshot, and thumbnail
deletion counts before confirming that the catalog no longer exposes it.

Domain projection tests require a valid v1 snapshot to produce a strict v0 document ordered by History without
mutating the source or leaking History and feature semantic-input declarations. Application adapter tests cover
schema-version-1 recovery through that projection, canonical base/result equality, legacy sketch and feature add
translation, final-History anchoring, first-party semantic-input derivation, draft transaction identity, and
authority rollback when persistence rejects a commit. Snapshot-derived recovery fixtures require provenance,
diagnostics, and unavailable-record evidence to survive the v0 compatibility projection and remain visible in the
session report.

Native-format tests separately require deterministic `.vshape` v1 bytes, a strict version-1 manifest, exact
three-entry/resource enforcement, explicit v0/v1 dispatch, and replay-to-migration canonical equality. They also
recompute semantic-entry checksums after tampering with History and require the reader to reject the archive.
Version-2 tests separately cover native v1 replay from document creation, complete legacy-prefix migration followed
by an anchored History suffix, explicit checkpoint evidence, deterministic bytes, v0/v1/v2 dispatch, exact-entry
enforcement, and rejection of tampered seeds, History anchors, and promotion boundaries after checksums are
recomputed. Manifest tests also reject JSON/NDJSON media-type substitutions before replay.
Legacy `readVShape` and `writeVShape` remain strict v0 compatibility gates.

The transitional model-tree suite verifies that the schema-version-0 graph projection produces one History
branch, keeps Datum Planes in History but out of Bodies, lists only terminal solid results under Bodies, exposes
origin-plane and feature/profile provenance, and preserves stable sketch and feature activation. It also proves
that the sketch-edit rollback marker is transient, marks only later rows, disappears outside sketch mode, and is
never claimed when graph construction fails. These component tests do not substitute for the Slice 0C migration
matrix or claim persisted authored order. Disclosure tests also prove that collapsing History or Bodies never
switches workspaces or closes an active sketch, while keyboard tests cover the roving tab stop and hierarchical
arrow navigation. A large independent fixture verifies that source-label lookup remains linear rather than
rescanning History for every row.

## Geometry assertions

Prefer:

- valid closed solid;
- expected solid and shell count;
- volume, area, center of mass, and bounding box within tolerance;
- distance, radius, and angle;
- semantic output or reference result;
- mesh manifoldness and orientation;
- STEP round-trip metrics;
- feature-failure kind and owning feature.

Never use these as the only oracle:

- B-Rep binary equality;
- identical face or edge order;
- exact triangle order;
- a screenshot of a plausible shape;
- absence of a thrown exception.

## Sketch solver tests

- One fixture for each constraint, including Midpoint and Symmetric native ABI mappings.
- Constraint combinations and fully defined canonical sketches.
- Over-constrained inputs with the expected conflict set.
- Under-constrained inputs and degrees of freedom.
- Near-degenerate geometry.
- Scale from very small to large parts.
- Drag continuation without branch-solution jumps.
- Random perturbations and residual thresholds.
- Deterministic results for the same input and build.

External-reference repair tests cover missing targets, sketch-to-sketch targets, incompatible topology kinds, and identity preservation for the reference, projected entities, metadata, and dependent constraints. Worker and protocol tests require exact current-generation model-reference evidence to use the production topology, geometry-kind, projection, and planar-intersection path, report unavailable or degenerate materialization as broken, and expose no kernel diagnostic text. History tests merge that evidence with pure sketch identity and propagate model failures through later sketch-backed chains. Component tests require repair mode to filter model candidates by producing feature and compatible topology kind, filter sketch candidates by point, line, or exact analytical curve compatibility, cancel without mutation, and return to Select after one successful pick in both the normal sketch layer and orbitable 3D viewer. One Playwright workflow replaces a real model edge graphically, finishes the sketch, reopens it, and requires the replacement's friendly label with no semantic-role or transient topology text. A second workflow deletes one referenced source-sketch line while retaining another, requires a visible `Missing line` state in the dependent sketch, selects the compatible replacement directly on the canvas, and verifies resolved geometry and provenance after Finish and reopen in Chromium, Firefox, and WebKit.

External-inference tests additionally require exact point projection onto analytical circles, bounded
positive-sweep circular and elliptical arcs, and full ellipses, deterministic line-over-curve priority, Shift suppression, source highlighting, and
commit-only materialization. Component coverage proves that Point creates one stable external curve and
one exact curve relation, while Line keeps its first placement provisional and materializes the same
relationship only after the second click. The Playwright workflow wakes an earlier circle without
activating Use, verifies that no duplicate reference geometry exists before or after acceptance, and
reopens the saved dependent sketch with the same friendly source label and constraint.

Selection-driven ellipse-locus coverage requires one selected point plus one full ellipse to expose the
existing Point on curve action, persist one exact Point on ellipse relation, and survive Finish and reopen
in Chromium, Firefox, and WebKit. One selected point plus one elliptical arc must expose the same action,
persist the distinct exact positive-sweep Point on elliptical arc relation, and survive Finish and reopen.

Model-curve wake-up coverage requires exact center/normal plane evidence, unique stable-topology
resolution, and a circle, bounded-arc, or exact full-ellipse projection before a candidate enters passive inference. Candidate
tests keep parallel-offset, tilted, and ambiguous circular edges outside that path.
Component tests verify Shift suppression, source highlighting, one stable `model-curve` reference, one
Point on curve constraint, Point and provisional-Line center wake-up through the first stable projected
point identity, and the absence of persisted candidate or reference-geometry payloads. The real Chromium
Cylinder workflows sample away from the seam vertex and at an offset center, finish the dependent XY
sketches, and reopen them with the same friendly circular-edge labels and constraints.

Point-alignment coverage requires distinct non-dimensional Horizontal points and Vertical points records,
strict point-only references, zero projected-axis solver equations, stable constraint handles, and exact
quarter-turn orientation swapping. Inference tests query the complete matching row or column without a
full point scan, retain Coincident and Point on curve priority, skip an active line anchor, expose H/V
preview glyphs, honor Shift suppression, and atomically materialize a passively woken model-curve center.

Sketch-support replacement tests require origin-to-face and face-to-origin domain transitions to preserve all sketch/entity/constraint/external-reference identities and reject invalid support records. Viewer and component tests require a bounded, closest-first, deterministically tie-broken face stack, feature/face deduplication, exact hover labels, visual preselection while cycling, pointer and keyboard acceptance, Escape dismissal, focus restoration, and an explicitly active picker when the current support is a model face. Session tests cover entering, canceling, accepted selection, local Undo, and return to the original create/edit context. The browser workflow keeps later History items hidden, disambiguates overlapping model faces without silently accepting the first hit, replaces support through a real 3D face pick, preserves authored geometry, and verifies the same resolved support label after Finish and reopen.

Sketch-support health tests independently cover resolved, missing, ambiguous, and unavailable owner states. History must offer repair only for missing or ambiguous topology, while a failed or blocked owner remains unknown instead of being mislabeled as a lost face. Component coverage requires the task panel to name the support problem and the History warning action to enter graphical replacement directly; no test may accept automatic retargeting of the persisted `TopoRef`.

SPK-002 implements the native baseline through `bun run solvespace:evidence`: 19 constraint fixtures, including zero-valued horizontal and vertical point alignment with raw-fixture and production-compiled solved-coordinate assertions, receive 100 deterministic perturbations each; production-compiled quarter-arc and edited-semicircle fixtures assert exact positive-sweep arc midpoints, rotated and axis-inverted ellipse fixtures assert the exact selected-axis quadrant branch, primary-major, secondary-major, and axis-inverted fixtures assert the generic full-ellipse locus, and minor, major, wrapped, and axis-inverted fixtures assert the exact bounded elliptical-arc locus through the native solver; the canonical dragged line receives 100 larger perturbations; conflicting dimensions and point alignment return their authored handles; a zero-length line stays finite; 1,000 create/solve/dispose cycles verify the post-corpus heap plateau; and the raw ABI repeats its fixture corpus inside a Chromium module worker. The production suites additionally validate every domain constraint family and semantic entity reference, deterministic sketch command replay, pure Point/Line/Midpoint Line/corner Rectangle/Center Rectangle/Aligned Rectangle/Centered Aligned Rectangle/center-point Circle/three-point Circle/Center-point Ellipse/center-point Arc/three-point Arc/Tangent Arc/Straight Slot/Centered Slot/selected-line Slot editing operations, analytical point/line/arc/circle/ellipse Mirror and Transform cases, deterministic existing-point/line-midpoint/arc-midpoint/segment-intersection/point-on-line/circle-and-bounded-arc-quadrant/full-ellipse-quadrant/full-ellipse-perimeter/bounded-elliptical-arc-perimeter/direction/tangent inference, single-reference external curve materialization, candidate-allocation-free stable quadrant and arc-midpoint scanning plus bounded stable perimeter scanning across 2,500 coincident curves, spatial candidate filtering equivalent to full inference across 1,000 distant points and lines, cascade deletion, variable-dimension compilation, exact worker state, complete transient-draft forwarding, stable-ID continuation and drag precedence, conflict mapping, and rebuild-before-retry recovery. Ellipse compiler fixtures require two solver-owned axis lines, one internal Perpendicular equation, no authored mapping for that internal equation, and five unconstrained degrees of freedom. Each ellipse-quadrant record reserves four private auxiliary entities, four private parameters, five exact trammel-locus equations, and one selected-axis equation; all six native equations map back to the single authored constraint identity. Each generic point-on-ellipse record reuses the exact trammel locus with four private auxiliary entities, four private parameters, and five native equations mapped to its single authored identity. Each point-on-elliptical-arc record adds one private oriented-chord half-plane equation and slack parameter to that exact locus; all six equations map to one authored identity, deterministic interior seeding avoids a singular boundary start, and post-solve parameter validation rejects the complementary branch fail-closed. Axis-diameter fixtures require each authored constraint to map to one stable native point-to-point distance at half the diameter; protocol tests restrict them to full ellipses and elliptical arcs, transform tests remove stale diameters when scaling, and the Chromium product flow drives both axes with separate endpoint labels. Slot fixtures require one construction centerline, two line sides, two analytical semicircular end caps, and the minimal nonredundant parallel intent accepted by SolveSpace. Profile tests cover rectangles, slots, analytical arcs, circles, and axis-aligned or rotated ellipses; exact ellipse area, bounds, and line intersections; nested holes and islands; tolerance snapping; construction exclusion; entity-order determinism; invalid solved values; bounded diagnostics; and fail-closed open, intersecting, duplicate, and degenerate geometry. Selector tests reject noncanonical or overlapping boundary intent, resolve the same stable entity sets after transient loop indices move, and return explicit missing or ambiguous outcomes instead of choosing another region. Extrusion preparation tests materialize exact line, arc, circle, and ellipse loops from solved stable IDs, cache one solve per sketch and rebuild, reject stale or missing selectors, and never persist transient indices. Domain registry tests require no dependency for New and exactly one target for Add, Remove, and Intersect while keeping schema-version-1 new-body records readable. Component tests cover the state-agnostic sketch-dimension and extrusion fields before their TanStack Form adapters, debounced draft publication, disposable preview-document composition, terminal content-hash appearance, operation and terminal-target selection, compatible-selection constraints, visible failed-constraint identity, source-expression preservation, adjacent focusable errors, async double-submit suppression, exact profile presentation, interactive selection, pointer-coordinate mapping, inference glyphs and accepted constraints, Shift suppression, exact three-stage ellipse preview and commit, authored and stable external full-ellipse and bounded elliptical-arc perimeter acceptance, both Mirror selection orders and step guidance, variable-aware exact Transform entry, affine-preserving point-snapped Transform-origin relocation, animation-frame reduction of raw drag samples, one layout snapshot per drag, inference-index prewarming and reuse across gestures, viewport-local drag frames with one release commit, exact sketch-object reuse with a separate drag target, immediate active-target rendering, adaptive bounded exact feedback during continuous movement for both ordinary and dense drafts, an incident-geometry-only drag overlay over a stable indexed base, curve/point memo boundaries, and one in-flight solve plus latest-pending coalescing. The product Playwright sketch flow creates `#width`, authors and fully constrains a real canvas rectangle, exercises local undo/redo, verifies exact SolveSpace area/perimeter, keeps the canvas height fixed while at least 96 lines populate a scroll-contained constraint panel, mirrors geometry through preselected and axis-first flows with exact solver feedback, transforms a selection through the precise project-unit-aware form, and drags a physical endpoint with a bounded visual response and stable final solve state. It separately verifies grouped family selection; Midpoint Line and Three-point Circle previews and intent; Center Rectangle preview, construction spokes, and non-over-constrained `DoF 4`; Three-point Arc circumcircle preview and positive-sweep persistence; Aligned Rectangle perpendicular/parallel intent; Centered Aligned Rectangle center-axis/midpoint intent; Tangent Arc endpoint/tangent intent and return to Line; Straight and Centered Slot analytical outlines; selected-line Slot construction conversion; automatic perpendicular, midpoint, exact point-on-ellipse, and exact point-on-elliptical-arc persistence with Shift suppression; and one-step local history. The flow finishes despite double activation, refactors the variable-backed dimension, removes and recreates a dimension, reloads IndexedDB state, restores authored expressions, and runs in Chromium, Firefox, and WebKit. The extrusion flow carries that stable selected profile into a symmetric new-body feature, verifies exact unsaved create and edit previews before any new document revision, cancels without mutation, edits the variable, confirms authoritative geometry, and restores the expression, selector, and symmetric state after reload. The geometry-worker Chromium harness independently verifies the exact `3,600 mm³` prism, exact Add, Remove, and Intersect volumes, bounds, meshes, and native ownership against a box target, plus an exact `π × 5 × 10 × 12 mm³` ellipse prism with semantic topology and disposal. The lower-level harness still loads the promoted generated WASM through the real document worker, solves a variable-driven fully constrained line and a `#width` by `#height` rectangular profile, performs two continuation drags, and requires a 1,000-point sketch to solve in less than 2 seconds with no more than 64 MiB of WASM heap. `bun run solvespace:build` and extended native evidence reject truthy `CI`; the production build and browser harness run locally before merge.

Modifying Revolve coverage mirrors the explicit-target Extrude contract. Domain, protocol, preparation,
and document-graph tests preserve `new`, `add`, `remove`, and `intersect`, require the target as the first
body dependency, deduplicate a target that also owns the sketch support, reject missing or misplaced
dependencies, and keep schema-version-1 new-body records readable. The real Chromium geometry-worker
harness verifies an exact `1,000π mm³` revolution and exact Revolve Add, Remove, and Intersect volumes,
bounds, meshes, single-solid validity, and native ownership against a Box target. The product flow edits
a persisted new-body Revolve into Remove, verifies its disposable preview, saves it, reloads the project,
and restores both the operation and friendly target selection.

Reference-dimension coverage validates strict value-less domain and protocol records for distance,
projected distance, angle, radius, and diameter; rejects value tampering; and proves that compilation
adds no native constraint, handle, or solver-state change. Component coverage derives the displayed
measurement from live solved geometry, publishes it to the accessible task-panel row, requires a
visible parenthesized dashed cue, and prevents opening a driving expression editor. The Chromium
product flow creates a reference dimension, finishes the sketch, reloads persisted browser state,
reopens it from the model tree, and verifies the same semantic mode and live annotation.

Arc midpoint branch-selection coverage seeds a quarter arc on the complementary bisector and carries
a stale midpoint through an endpoint edit to a semicircle. Both production-compiled fixtures must
solve on half of the current positive analytical sweep rather than preserve the nearest invalid branch.

Full-ellipse Quadrant coverage evaluates all four analytical axis extrema, rotated and degenerate
ellipses, stable tie-breaking across 2,500 coincident curves without sorting, authored geometry,
earlier-sketch references, and coplanar model projections. Domain and protocol limits reserve the exact
private solver footprint. The production compiler maps six native equations to one authored identity,
and local native evidence covers positive and negative primary and secondary sides. The positive-primary
case starts from an axis-inverted stale point seed; every case must remain on the selected axis, retain its
persisted side, and match the exact solved axis radius. The product Playwright flow authors a negative
primary quadrant from the canvas, verifies its accessible annotation, finishes the sketch, and reopens the
same persisted constraint in Chromium, Firefox, and WebKit.

Elliptical Arc coverage adds domain construction and axis/quadrant reuse tests; exact solver-owned
trammel entity, parameter, and constraint records; fail-closed on-ellipse profile validation; exact
half-ellipse area, bounds, intersections, and perimeter; strict worker-protocol validation; ordered
document-worker extrusion materialization; OCCT kernel-frame handedness, major-axis, and reversed-loop
tests; a real Chromium geometry-worker extrusion yielding one valid `300π mm³` solid with exact
`[-10, 0, 0]` to `[10, 5, 12]` bounds and stable topology roles; a four-pick component workflow; and
a Chromium, Firefox, and WebKit Playwright authoring flow with construction-ellipse preview plus
one-step Undo/Redo. Bounded-locus coverage additionally requires exact nearest analytical projection,
minor, major, wrapped, rotated, and axis-inverted positive sweeps, complementary-branch exclusion,
one stable external reference with five role-ordered projected point IDs, direct-selection compatibility,
native equation evidence, post-solve fail-closed validation, and Finish/reopen persistence.

Direct ellipse modification coverage requires analytical quadratic line intersections; stable-ID
full-ellipse Trim and Split; one-point elliptical-arc Split; endpoint Extend; preservation of axis
diameter constraints; complementary-arc profile area, bounds, and perimeter; and shared hidden
SolveSpace axes and endpoint loci without redundant equations. Component coverage verifies the
two-point split preview, while the Chromium, Firefox, and WebKit product flow exercises Trim, Split,
Undo, exact solver status, and non-tangent Extend. Round and ellipse boundaries remain outside this
slice until their exact intersection and persistent endpoint-constraint contracts are implemented.

The Linear Pattern slice adds pure domain coverage for bounded one/two-direction transform grids,
shared-point cloning, internal-constraint identity remapping, rotation-compatible orientation intent,
and fixed-constraint omission. Component coverage proves variable-aware TanStack Form parsing,
bounded SVG preview, and one recorded commit. The product Playwright scenario creates a
two-direction pattern and reverses the complete operation with one Undo in every target browser.

The Circular Pattern slice adds pure domain coverage for arbitrary-center transforms, closed and
open angular distributions, count and overlap bounds, materialized entity identity, and compatible
orientation-constraint rotation. Component coverage proves variable-aware TanStack Form parsing,
the visible center and bounded SVG preview, and one recorded commit. The product Playwright
scenario changes the exact center and count, applies the pattern, and reverses every occurrence with
one Undo in every target browser.

## TopoRef matrix

For every reference-heavy fixture:

- change upstream length or radius;
- cross a symmetry threshold;
- add or remove topology through a boolean;
- change pattern count;
- reorder or suppress valid features;
- assert `resolved`, `ambiguous`, or `missing`;
- verify that ambiguity never becomes a silent wrong selection;
- verify repair → save → reopen → rebuild.

SPK-003 implements the bounded algorithm-selection matrix through `bun run topology:evidence`. A dedicated Chromium worker rebuilds 12 exact OCCT scenarios covering dimensions, hole radius and position, fillet radius, pattern count, feature suppression, restoration, and symmetric holes. The report records semantic, composed face-lineage, signature, ambiguity, and missing outcomes and fails on any duplicate semantic role or false confident match. Both the runner and `playwright.topology.config.ts` reject truthy `CI`; reports and Playwright diagnostics stay under `.artifacts` and the ordinary pull-request workflow never invokes this corpus.

## Format tests

### `.vshape`

- deterministic v0 bytes for identical semantic input and export metadata;
- snapshot plus complete journal round-trip with stable variable IDs, formulas, analytical sketch records, sketch dimension expressions, and feature `#variable` sources intact;
- snapshot/journal exact replay equality before import;
- checksum corruption, undeclared entry, traversal, duplicate normalized path, and ZIP-bomb limits;
- one-transaction IndexedDB publication and same-ID collision rejection;
- real-browser download into a fresh storage context, import, worker rebuild, and authored-source restoration;
- future versions add required-capability behavior, sequential migrations, cache independence, truncated-journal recovery, and a stable old-fixture corpus before claiming those contracts.

### STEP

- AP242 and AP214 fixtures;
- millimeter and inch units;
- multiple bodies, names, and colors;
- invalid imported shape and healing report;
- export/import metrics;
- automated local headless import in FreeCAD plus broader manual checks in another available reader.

### STL and 3MF

- Binary STL facets, endianness, and header edge cases.
- Non-manifold import.
- 3MF OPC relationships, XML schema, and resource IDs.
- Components, transforms, and units.
- Independent slicer open.
- Dimension comparison after slicer import.
- Malicious XML and ZIP inputs with no external entity or network access.

SPK-004 implements the 3MF writer baseline with strict Zod input and report schemas, deterministic archive tests, XML escaping and forbidden-character checks, resource-reference ordering, manifold edge and per-component orientation validation, transform checks, thumbnail signatures, and explicit budgets. `bun run formats:evidence:3mf` is the local interoperability gate: it rejects `CI`, generates the exact artifact in Chromium, requires byte identity with two Bun generations, checks the OPC entries, rejects DTD/entity declarations, runs `xmllint`, and requires at least two independent slicer families to report 24 manifold facets and `1,608 mm³`. The recorded matrix uses PrusaSlicer and the Orca/Bambu family. Artifacts stay under `.artifacts/3mf-spike`, and no GitHub Actions workflow invokes the command.

## Local-first persistence tests

- Strict record and commit-envelope validation.
- Atomic event, snapshot, project-head, recovery-marker, and writer-lease transactions.
- Stale revision and quota-failure rollback with no partial record.
- Latest-snapshot corruption, event replay, bounded-loss fallback, and clean-close status.
- Forced page termination followed by recovery in a new page using the same browser storage.
- Live-writer blocking, expired-lease takeover, epoch advancement, and old-writer rejection.
- OPFS staged write, SHA-256 verification, content-addressed publish, missing-file behavior, engine-build invalidation, and orphan cleanup.
- Capability invocation rather than method-presence detection, including a cache-disabled OPFS state.
- Service-worker cached-shell reopen while its network fetch boundary is forced offline.
- Dirty-document update deferral, user-gesture persistent-storage policy, and Save As fallback selection.
- Atomic v0-to-v1 promotion, provenance retention, v1 suffix replay, bounded v1 loss, the legacy write barrier, and preservation of the v0 rollback source.
- Authoritative v0/v1 project catalog selection, exact-head previews, and the post-promotion legacy preview barrier.

SPK-005 implements this boundary through `bun run persistence:evidence`. The runner and `playwright.persistence.config.ts` reject truthy `CI`, exercise Chromium, Firefox, and WebKit serially, and write reports only under `.artifacts/persistence-spike`. The recorded WebKit runtime keeps semantic IndexedDB recovery operational while reporting OPFS unavailable. No GitHub Actions workflow invokes the persistence evidence command. See [SPK-005 evidence](spikes/spk-005-local-first.md).

## Extension sandbox evidence

SPK-006 implements a private package and hostile browser harness through `bun run extension:evidence`. The command rejects truthy `CI`, runs package tests with Vitest, then exercises Chromium, Firefox, and WebKit serially through `playwright.extension.config.ts`. Reports stay under `.artifacts/extension-spike`, and no GitHub Actions workflow invokes the command.

The accepted evidence covers pre-extraction ZIP limits, path and symlink rejection, strict manifests, exact checksums and archive integrity, publisher identity, exact-version coexistence, no-import WebAssembly, JavaScript-worker ambient-authority probing, loop termination, message and output budgets, capability revocation, restricted states, and opaque-origin iframe messaging. The result is reduced scope because arbitrary same-origin workspace JavaScript is rejected and a portable hard memory ceiling is not proven. See [SPK-006 evidence](spikes/spk-006-extension-sandbox.md).

## Memory and leak tests

- Repeat one operation and undo 1,000 times.
- Open and close a document 100 times.
- Import STEP and dispose it.
- Change display LOD repeatedly.
- Restart the worker.
- Compare WASM heap high-water mark, steady-state usage, and live-wrapper counters.
- Confirm `renderer.info.memory` returns near baseline within an allowed cache margin.

Growth has a numeric budget. “The browser did not crash” is not a criterion.

## Performance budgets

Initial goals on the baseline laptop after warm-up:

| Scenario | Goal |
|---|---:|
| UI input during rebuild | No main-thread long task over 100 ms |
| Controlled worker cold initialization with a warm local asset cache | p95 under 500 ms |
| Simple feature preview | p95 under 500 ms |
| SPK-001 WASM linear-memory capacity | Peak under 64 MiB |
| SPK-001 live native allocation | Peak under 4 MiB |
| Rebuild 50-feature bracket corpus | Under 5 s |
| Viewport with 500k triangles | Target 60 fps, minimum 30 fps |
| Typical domain autosave transaction | Under 100 ms |
| Open a 20 MiB semantic project without cache | Under 3 s plus rebuild |

Budgets change only through benchmark evidence or an ADR. CI detects major regressions; stable performance runs use controlled hardware rather than shared runners alone. `bun run occt:evidence:performance` executes 10 local page runs and 20 cold workers against the staged controlled artifact, records raw samples under `.artifacts`, and fails when any SPK-001 budget is exceeded. Both the runner and its dedicated Playwright config reject `CI`, so this evidence cannot consume GitHub Actions minutes accidentally.

The SPK-001 technical release bundle is also generated locally. `bun run occt:bundle:compliance` rejects `CI`, applies the committed modification to the pinned upstream file, packages the exact source and build evidence, and writes a strict manifest plus checksums. `bun run occt:verify:compliance` rejects missing, extra, duplicate, unsafe, or hash-mismatched payload entries and verifies every pinned source identity. The ordinary pull-request workflow does not generate this artifact.

`bun run occt:evidence:step` is the local independent-application STEP gate. It rejects `CI`, exports the controlled fixture through Chromium, transfers the exact file from the geometry worker, and invokes headless FreeCAD with an isolated configuration. The gate verifies the input length and digest, one valid solid, relative volume error no greater than `1e-8`, and maximum bounds delta no greater than `1e-5` mm. FreeCAD uses OCCT internally, so this proves application and import-path interoperability rather than kernel diversity; broader format corpora still require other readers.

## Browser matrix

- Chromium, Firefox, and WebKit automation: required locally before merge; excluded from automatic PR jobs to preserve the Actions budget.
- Manual Safari: release smoke coverage for platform integration that WebKit automation cannot prove.
- Dedicated installed-build offline/service-worker test.
- Cross-origin isolation mode only when enabled.
- Device pixel ratio 1 and 2, plus integrated and discrete GPUs where possible.

## Viewport interaction coverage

Orbit-view external-reference coverage requires the viewer hit stack to retain deterministic order, preview
the cycled candidate, support forward and reverse grave-accent navigation, commit with Enter or pointer
activation, and clear with Escape. Browser coverage proves point-versus-line Select Other disambiguation in
the persistent 3D viewer in Chromium, Firefox, and WebKit.
The same browser flow requires a selected model edge to retain its localized feature-and-edge label in the
external-reference list after save and reopen. Focused topology-label tests cover resolved face, edge, curve, and
vertex ordinals plus explicit missing and ambiguous states, preserve semantic ordinals when evaluation-local
candidate arrays and IDs are permuted, and reject semantic-role or candidate-ID leakage.
The elliptical model-edge regression authors and extrudes a full ellipse through the product UI, selects the
resulting exact OCCT elliptical edge through graphical Use, and requires its localized feature-and-edge label
and stable analytical reference to survive Finish and reopen in Chromium, Firefox, and WebKit. Protocol tests
reject non-orthonormal or left-handed ellipse frames, invalid radii, off-curve bounded points, source-type and
geometry-class drift, and degenerate projections; projection tests cover full and bounded analytical results.

- Unit tests verify zero-copy typed-array binding, projection fallback, SVG-compatible aspect normalization and planar-center mapping, friendly face ordinals, and exact extraction of every triangle belonging to a rendered face.
- React component tests verify lazy adapter ownership, terminal-mesh filtering, exact historical and unsaved-preview feature highlighting from tree preselection and active edit, active and idle origin-plane selection synchronization, face and graphical sketch-reference callback wiring, hover-only external-reference preselection over persistent muted context, conditional empty-rollback final-context guidance, empty-model datum initialization, initial and explicit fit behavior, camera preservation across mesh replacement, live sketch pan/zoom projection publication, latest-value animation-frame coalescing without candidate-geometry rebuilds, imperative Three.js synchronization across normal/orbit transitions without a viewer remount, sketch continuation and drag-target forwarding, cross-support point and line projection, read-only external-line selection, last-valid solved-display retention, disposal, and localized renderer failure containment.
- Playwright creates a real persisted variable-driven Box, waits for measured WebGL2 canvas output, selects a rendered face through an actual pointer click, observes the accessible feature-and-face summary, and clears it through the visible control. A primary-button drag must change the real WebGL canvas without activating a sketch plane. After identical Fit view resets, wheel zooms from opposite pointer positions must produce different camera targets and rendered views. The sketch flow scans real canvas preselection state, selects an origin plane before the command, enters editing directly on that support, finishes, and reopens with the same support. It separately clicks an XY origin plane through Three.js raycasting after command activation and proves the synchronized keyboard-equivalent native select path.
- The selection flow runs locally in Chromium, Firefox, and WebKit. Empty click, rebuild clearing, pointer-mode expansion, and stable `TopoRef` integration receive focused regression tests with their owning implementation slices.

## Playwright execution contract

- `bun run test:e2e:chromium` is the fast local browser gate; `bun run test:e2e` runs all configured engines.
- `bun run test:e2e:ui` opens Playwright UI mode, and `bun run test:e2e:report` reopens the last HTML report.
- Install missing local engines with `bunx playwright install chromium firefox webkit`.
- Tests use role, label, and other user-facing locators with web-first assertions. Fixed sleeps and selectors coupled to styling or implementation details are prohibited.
- The automatic runtime-health fixture fails the owning test on browser console errors or uncaught page exceptions.
- Failure diagnostics are written locally under `.artifacts/playwright` and are not uploaded automatically.
- Automatic PR CI runs no Playwright project. The merge operator records the local all-engine result in the pull request.

## Monorepo and toolchain checks

- `bun ci` verifies workspace manifests against `bun.lock`.
- Typecheck, lint, and test run through workspace filters and root aggregate scripts.
- `fallow audit` gates error-severity findings introduced by a changeset, including dead code, dependency hygiene, duplication, complexity, styling drift, and configured package-boundary violations.
- Dependency-boundary tests prohibit UI imports in domain and protocol.
- Production Vite build confirms Tailwind discovery across `apps/web` and `packages/ui`.
- shadcn component updates pass typecheck, both themes, and keyboard E2E.
- Shared UI component tests cover native uncontrolled behavior before TanStack Form adapters, including double activation, async settlement, disabled/busy semantics, labels, and validation relationships.
- Editor-session component tests prove one vanilla Zustand store per provider mount, retention across ordinary rerenders, and reset only when the owning React boundary remounts.
- Planar-face Intersection coverage proves that persisted references exclude transient mesh identities, current worker-local face keys never cross the protocol boundary, 3D face selection routes only through the explicit tool, and the browser executes the exact OCCT section into one read-only sketch line. The current document protocol version is 15.
- I18n tests cover locale resolution, base-language fallback, blocked preference storage, runtime switching, document language/direction, duplicate namespace ownership, and exact English key/placeholder parity for every added locale.
- CI Bun pin matches `packageManager`; an incompatible local version fails with a clear error.

The automatic pull-request workflow is one Linux job: frozen install, skill validation, format, lint, typecheck, unit tests, critical dependency audit, and uncached Fallow audit. Production build, all Playwright suites, native builds, and spike evidence are local merge gates. The workflow does not run again on `main`.

Fallow complements but does not replace Biome, TypeScript, dependency CVE scanning, executable boundary tests, or behavior tests. CI checks out full history for merge-base detection, runs the new-only gate without an analysis cache, and distinguishes exit code `1` findings from exit code `2` configuration or runtime failures.

The foundation scaffold implements these gates as root Bun scripts. Vitest discovers TypeScript and TSX tests across workspaces and build scripts, including jsdom-backed component tests. The automatic pull-request workflow performs a frozen install, skill validation, formatting, linting, typechecking, unit tests, critical dependency audit, and uncached Fallow audit in one job. A superseding commit cancels the older run, and the squash-merged tree is not run again on `main`.

The external-sketch context suite requires a new unsaved draft to include every committed sketch while an existing draft excludes itself and later sketches. Component coverage proves that passive earlier points and lines wake without draft mutation, distinguishes solid ordinary source geometry from dashed construction geometry, and verifies that `Shift` suppresses the preview while acceptance creates one stable reference plus one local Coincident or Point on line relation. External-constraint coverage requires point and line relations to resolve annotation anchors from solved projected geometry, remain selectable with non-color external-relation semantics, and retain that presentation after Finish and reopen. Collision fixtures require source-sketch identity to disambiguate repeated entity IDs, including a two-reference external intersection. Dense inference fixtures require the spatially queried candidate set to match unbounded inference while excluding distant geometry from the pointer hot path. A graphical-overlap fixture requires the normal-view chooser to expose deterministic source labels without mutating the draft, cycle its analytical preselection forward and backward with grave accent, and commit only the Enter-confirmed source. Browser coverage proves both line wake-up without activating Use and keyboard-driven graphical disambiguation of two coincident earlier-sketch lines in Chromium, Firefox, and WebKit. A saved-later-sketch regression creates two sketches around an upstream body, reopens the later sketch, and requires normal mode to retain the body while assigning each earlier sketch only to the analytical projected layer. It then requires orbit mode to restore the earlier saved sketch plus one active draft to Three.js, verifies the model-tree visibility action in normal mode, and rejects duplicate saved-sketch rendering across layer transitions.

Global sketch-visibility coverage requires the model-tree header action and shared `Shift+H` command to hide every current saved sketch in both the analytical normal-view layer and the Three.js orbit layer while retaining the active editable draft, then restore the same context without duplicate rendering or rollback changes. Store and model-tree tests keep the state session-local and prove that individual visibility remains independently overridable.

The planar-face Intersection browser regression starts the command in normal sketch view, requires the application to transition directly into the orbitable 3D picker with visible target guidance, verifies that Normal to sketch disarms the command, selects a compatible OCCT face after reactivation, and checks the persisted associative intersection after Finish and reopen. The session regression requires Intersection to disable final-result context before selection so downstream meshes remain outside the authoritative History boundary.

Normal-view Use component regressions require the persistent target instruction, immediate resolved candidate labels for both pointer hover and keyboard focus, label removal on leave or blur without draft mutation, and unchanged activation through pointer, keyboard, and the deterministic overlap chooser.

The real geometry-worker primitive corpus extrudes minor, major, zero-crossing wrapped, and one-axis-reflected elliptical-arc profiles through OCCT. It requires each cap to expose exact analytical elliptical-arc topology with a right-handed frame, ordered start/middle/end points on the intended positive branch, exact projected endpoints on the sketch support, analytical volume and bounds, and deterministic ownership disposal.

The domain feature-graph suite verifies presentation versus evaluation order, duplicate and missing identities, cycles, declared topology dependencies, canonical scheduling serialization, first-run asynchronous evaluation, transitive dirty propagation, independent cache reuse, suppression, dependent-only failure blocking, independent branch continuation, stable rejected-evaluator containment, and fail-closed dirty/cache inputs. Application tests cover exact full-circle, major-arc, oblique, reflected, and rank-degenerate analytical projection plus committed-document validation, automatic root derivation, presentation-only reuse, ordered canonical geometry requests, complete rebuild-state validation, document and revision binding, worker-generation recovery, environment and mesh-policy invalidation, descendant-only rebuild, independent branch continuation, adapter-environment mismatch, stale-geometry exclusion, and exact non-degenerate affine projection of analytical sketch curves. Protocol and domain fixtures validate circular-edge frames and reject external-curve role-count, identity-collision, source-type, and projected-type drift; document-worker and SolveSpace fixtures prove recursively solved source coordinates, fixed projected parameters, and read-only point-on-curve participation. UI tests require mutually exclusive passive, selectable, and committed external-curve layers in normal and orbit views plus fixed-screen center crosshairs, while the Chromium sketch flow creates a source circle and uses it graphically in a downstream sketch. Persisted-session unit tests prove save-before-rebuild sequencing, no state or rebuild advance after an atomic storage failure, saved semantic retention across worker failure, retry, read-only lease fallback, read-only export, clean close, and invalid-boundary rejection. Protocol conformance proves that domain identities and the dependency-independent worker serialization are byte-identical; geometry protocol-v12 tests reject reordered hashes, missing slots, and duplicate dependency feature IDs, while document-protocol-v17 tests also reject envelope/snapshot drift, invalid display units, variable or sketch tables, invalid compound Offset pairs, mismatched transient drafts, stale solve state, unknown fields, oversized payloads, mismatched solution identities, and empty export transfers. Document-worker tests cover incremental state ownership, clean reuse, changed-descendant rebuild, cross-document isolation, stale queued generations, transferable mesh clones and export files, successful-terminal-body selection, print-mesh identity enforcement, deterministic 3MF packaging, stale and empty export rejection, disposal, health, invalid responses, duplicate request IDs, complete response-envelope matching, worker error and message-failure rejection, serialized session operations, retry classification, generation increments, and rebuild-before-solve-or-export recovery from the last successful semantic snapshot. Geometry-worker tests continue to cover environment and digest rejection before engine execution, typed geometry failures, logical cancellation, exact feature-cache reuse, transactional replacement, failed cleanup visibility, ordered dependency resolution, document isolation, and deterministic temporary compound ownership. The primitive feature Playwright scenario executes the actual worker and OCCT in every target browser and verifies shape, topology, analytical Cylinder rims and trimmed major-arc payloads, mesh, cache, rollback, ownership, and disposal invariants. The feature rebuild scenario sends a committed document through the browser document-worker session, proves zero OCCT evaluations for a clean rebuild, terminates the worker, proves a full recovery rebuild under the next generation, and then evaluates only a changed cylinder plus its Boolean descendant. The document export scenario creates product-shell bodies, verifies direct 3MF/STEP/STL downloads, remembers a preferred slicer across reload, proves an unavailable bridge downloads the already generated 3MF with accurate copy, and intercepts one exact authenticated loopback request containing the 3MF bytes in Chromium, Firefox, and WebKit. Bridge unit tests separately cover exact-origin pairing and rotation, portable metadata, credentials, rate and single-flight policy, request deduplication, owned temporary files, no-shell executable arguments, unavailable slicers, and path-free failures. The persisted rebuild scenario creates a variable-driven Boolean model through ordinary commands, commits every revision to IndexedDB, reloads without a clean close, recovers and rebuilds revision 5, closes cleanly, and reopens the same geometry in Chromium, Firefox, and WebKit. Persisted Boolean topology lineage remains a later integration suite.

The product Variables scenario opens the real browser document controller, creates and evaluates a raw table row, applies the whole table through a transaction-tagged persisted draft, reloads the page, and verifies the same authored and resolved values. It also creates a second row, filters the shared autocomplete from a partial `#name`, and inserts the authored token with the keyboard. The sketch-first scenario starts from the primary empty-document action, finishes one asynchronous constrained rectangle command despite double activation, returns directly to the 3D model view, displays the saved sketch on its exact support frame, toggles that sketch independently from the model tree, retains the saved profile as the selected sketch, and proves that tree activation enters editing directly. document-protocol-v17 tests validate bounded transferable line and point arrays, construction separation, stable sketch identities, duplicate rejection, exact support-frame projection, solver-result display, authored fallback display, and zero-copy viewer binding. The shell command scenario verifies application-bar palette opening, dialog focus restoration, `Ctrl/Cmd+K`, localized keyword search, visible disabled eligibility, command-driven sketch creation, and safe shortcut-driven tool activation in Chromium, Firefox, and WebKit. Registry unit tests reject descriptor/handler duplication, missing and orphaned entries, and owner drift; component tests cover filtering, keyboard selection, recent-command persistence, text-input shortcut safety, `Escape` cancellation, and shared toolbar eligibility. The Extrusion scenarios prove contextual eligibility, direct single-flight save-and-extrude from an open sketch, variable-driven origin-plane extrusion, and a stable selected planar Box-face support that creates a separately colored new body. They also prove exact disposable create and edit previews while the feature tree remains unchanged, cancellation back to committed geometry, authoritative rebuild, feature hide/show terminal counts, editing, and reopen. The Box scenario completes a partial `#variable` token for placement X through the secondary direct-solid path, persists and rebuilds the positioned feature, verifies that one terminal feature reaches a measured WebGL2 canvas and Fit view action, activates the Box from the feature tree, restores every authored dimension and placement source, updates another coordinate through the ordinary feature-update command, and verifies all values after reload. It then explicitly renames the committed variable, verifies that both Box dimension and placement sources changed from the exact old token to the new token without losing geometry, and reloads again to prove the refactor was persisted. The Cylinder scenario creates a centered and explicitly positioned feature with a variable-driven radius, edits its placement through the same ordinary feature-update path, reloads the page, and verifies the authored sources, coordinates, and centered state. The real-worker primitive harness additionally checks the positioned Box's exact OCCT bounds, volume, and semantic face roles. The Boolean/Subtract scenario creates one Box and two Cylinders, verifies command eligibility, persists a target-then-tool cut, switches the tool through feature update, checks terminal rendered-feature counts, and reloads to prove ordered dependency restoration. It then proves dependent-input deletion is blocked with a visible owner, double-activated destructive confirmation commits once, terminal geometry is restored after removing the Boolean, an independent primitive can be deleted, and both removals survive reload. Component coverage separately proves the state-agnostic Variables table, primitive panel, native select, and variable-expression combobox contracts plus their TanStack integrations; caret-local token replacement; self-suggestion exclusion; keyboard and pointer completion; toolbar ordering and profile-driven Extrude eligibility; Box, Cylinder, and Boolean create/edit identity; source-expression and dependency-order restoration; cycle-candidate filtering; tree activation by stable identity; focused invalid controls; localized adjacent validation; async double-submit suppression; destructive confirmation settlement; terminal-feature filtering and preview appearance; imperative viewer lifecycle ownership; and empty-state behavior. Domain tests prove stable variable and feature IDs, stable planar-face support invariants, support-owned deletion protection, exact-token refactoring, arbitrary-string preservation, expression-limit rejection, placement-default compatibility, placement-sensitive geometry identity, atomic command replay, and tamper rejection. Viewer-package tests prove direct typed-array `BufferGeometry` binding, retained triangle-to-face metadata, measured bounds, disposal events, sketch-reference geometry ownership, and finite orthographic frusta.

Feature-deletion eligibility tests use the authoritative document graph and cover feature dependencies, model-backed external sketch geometry, feature-face sketch support, and unavailable dependency models. Component coverage requires a state-agnostic blocked reason to disable the destructive action before a dialog can open. The Boolean/Subtract browser flow names its dependent feature and relation, while the model-reference flow names `Sketch 1` and the model-geometry relation after save and reopen; both keep Delete disabled. Leaf deletion retains its asynchronous single-flight, persistence, rebuild, and reload coverage.

The face-supported extrusion scenario also reopens its source sketch, keeps the preceding body visible in normal and orbit context, and verifies that model-tree Hide and Show remain effective without revealing downstream geometry. History rollback fixtures require every later item to disappear even when it has no dependency edge to the active sketch.

Planar Extrusion-side support coverage resolves a persisted line-source semantic role against current evaluated topology, keeps the persisted near-point fixed under tangential face growth, follows plane motion along its normal, produces a right-handed frame, and fails closed when the current match is ambiguous. The product browser flow selects the side directly in the 3D viewport, authors and reopens the supported sketch with the same readable face label, verifies the draft remains visible in Orbit, and builds a second exact extrusion from that sketch.

Production Vite build, the Chromium/Firefox/WebKit shell and OCCT E2E suite, controlled native builds, memory and performance evidence, FreeCAD STEP validation, compliance bundles, topology, slicer, persistence, and extension corpora are local pre-merge gates. Generated evidence stays under `.artifacts`. Heavy entry points reject a truthy `CI` environment and have no GitHub Actions workflow.

The current executable evidence covers the foundation shell; the document-worker-owned graph rebuild and 3MF/STEP/STL export coordinator, remembered-slicer fallback and authenticated loopback handoff, in-memory worker replacement and semantic recovery, and real-browser OCCT path; the application persisted-session contract and persistence-backed page reload plus clean save/reopen rebuilds; deterministic `.vshape` v0 semantic round-trip and fresh-storage browser import; additive IndexedDB preview-store migration with prior-data retention; deterministic bounded terminal-mesh SVG previews; new-project creation, local-project switching with semantic rebuild, replay-verified duplication with variable/source and preview preservation, and confirmed inactive-project deletion across reload; document protocol v17 with project display units, authored variables, analytical sketches, exact-revision committed and transient-draft solving, deterministic profile results, and export; production sketch schema and replay; exact SolveSpace runtime hashes; variable-backed dimensions and signed connected-line Offset; stable-ID continuation and drag precedence; worker recovery; and a real-WASM variable-driven rectangular profile plus 1,000-point browser budget; the geometry-protocol-v12 explicitly positioned box, cylinder, and dependency-aware Boolean/Subtract boundary; SPK-001 worker ownership, operations, memory, performance, exchange, and restart; SPK-003 semantic and composed topology resolution; SPK-004 deterministic 3MF and slicer invariants; SPK-005 transactional recovery and offline fallback; and the reduced-scope SPK-006 package and isolation boundary. It does not yet prove general interior-intersection splitting, stable persisted profile selectors, document-integrated topology repair, a complete production CAD workflow, active-project deletion UX, a real two-build service-worker update, `.vshape` migrations or same-ID restore, persistent derived-cache promotion, signed slicer-bridge distribution, installed-build release behavior, configurable print-quality export profiles and reports, interactive placement manipulators or primitive rotation, or production extension execution.

Extended OCCT lifecycle runs are parameterized without slowing the normal PR matrix:

```bash
VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS=1000 \
VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES=5 \
bun run test:e2e -- --project=chromium tests/e2e/geometry-worker.spec.ts
```

The current controlled allocator plateau, executable ceilings, and hard-restart baseline are documented in [SPK-001 evidence](spikes/spk-001-occt-worker.md).

Ordered external-sketch reference coverage includes a three-sketch chain where the final sketch graphically selects a projected line owned by the intermediate sketch. Domain validation accepts that projected identity, the document worker resolves the chain recursively, and the Playwright workflow edits the original line before requiring the final projection to update after reopen.

Pierce coverage uses two perpendicular sketch supports. Pure application tests reject parallel, coplanar,
degenerate, non-finite, and outside-segment inputs; domain and protocol tests preserve the dedicated reference
and projected point identity; health tests require the source to remain a line; and document-worker tests
recompute the exact crossing from the current solved source coordinates. The browser flow preselects one
authored point, chooses the labeled earlier-sketch line in the orbitable picker, verifies Coincident and the
read-only Pierce point, then finishes and reopens the dependent sketch without losing the relation.

## Design and UX acceptance

Every core flow is checked against the [Design and UX Guidelines](product/design-and-ux-guidelines.md).

Automated coverage includes:

- keyboard access and focus order for application bars, toolbars, menus, dialogs, the model tree, and the command palette;
- focus trap and restoration for modal layers;
- accessible names, dialog titles, form labels, validation relationships, and live status regions;
- no single-letter shortcut activation while typing or composing text;
- command Apply, Cancel, `Escape`, and one-entry undo boundaries;
- persistent save, export, topology, worker, and format failures rather than toast-only messages;
- dark/light contrast checks and non-color state cues;
- screenshots at 1440 px, 1024 px, and 200% zoom;
- minimum pointer target size or compliant target spacing;
- reduced-motion behavior;
- long labels and expanded text without loss of primary actions;
- worker delay, stale response, cancel-requested, and crash-recovery states.

Manual alpha review includes keyboard-only completion of all non-spatial parts of the bracket flow, screen-reader smoke tests for Chrome and Safari platform combinations, trackpad navigation, and the usability tasks defined in the guidelines. Free-form canvas sketching remains a documented limitation rather than an unverified accessibility claim.

## Security fuzzing

- Schema fuzzing for commands and native files.
- ZIP and XML fuzzing.
- STEP and STL parser corpus with timeouts.
- Huge counts, NaN, Infinity, and integer overflow.
- Worker crash and restart.
- Content Security Policy test.
- Dependency audit and SBOM.
- No-network privacy test while offline.

## Extension conformance and isolation

SPK-006 accepts only the immutable package, no-import WebAssembly, capability, restricted-mode, and opaque iframe candidates under [ADR-0012](adr/0012-capability-based-extension-platform.md). Any later extension-enabled release must extend that evidence to cover:

- deterministic replay of parametric feature modules across fresh hosts;
- absence of network, time, randomness, DOM, storage, file, clipboard, undeclared imports, and raw-kernel access in the feature profile;
- manifest, entry-point, integrity, API-version, normalized-path, duplicate, traversal, decompression, asset, message, and output limits;
- exact coexistence of two versions and rejection of same-version/different-integrity substitution;
- missing, disabled, incompatible, timed-out, resource-limited, and failed extension states;
- restricted-mode open, preservation, original-archive export, repair, and later successful rebuild;
- CPU loop termination, worker restart, message flood containment, memory budget, and no partial commit;
- opaque-origin iframe CSP, `MessagePort` handshake, schema validation, session/sequence checks, and navigation denial;
- capability deny, grant, update expansion, revocation, and host termination with no residual authority;
- update preview, disposable rebuild, invariant comparison, one-command lock commit, and rollback;
- extension-command parity for eligibility, async busy, double activation, cancellation, undo, localization, keyboard access, focus, and diagnostics;
- English base-catalog and ICU placeholder parity without allowing extension copy to replace host security text;
- license, notices, source, signature, and publisher identity as separate validation results.

A Web Worker or successful WebAssembly instantiation alone is not isolation evidence. Tests must exercise the browser APIs and host messages that a hostile package would attempt to abuse.

## Automation and MCP conformance

The adapter-neutral automation layer is tested before an MCP dependency exists. Query and command fixtures cover:

- bounded, revision-tagged resources with pagination and semantic-versus-derived markers;
- explicit command input and structured output schemas plus stable diagnostics;
- disposable draft creation, multi-command preview, validation, commit, discard, and expiry;
- stale base revisions, duplicate idempotency keys, conflicts, cancellation, worker crash, and browser disconnect;
- actor provenance and ordinary undo/redo after an automation commit;
- denial of direct store, storage, raw file, kernel, extension-management, and generic execution access.

The current conformance fixtures cover strict input rejection, exact-revision reads, bounded semantic summary output, cursor-paginated evaluated-variable output, command and feature-type descriptor-handler parity, command rejection on active feature-type composition drift, exact feature-type identity and unavailable-type preservation, canonical metric/imperial/angle/scalar normalization, variable syntax and unit parsing, forward and backward dependencies, cycle and missing-reference rejection, dimensional arithmetic, revisioned variable mutation and tamper-resistant replay, referenced-variable deletion protection, bounded box/cylinder dimensions and placement plus Boolean/Subtract parameter validation, trusted parameter-expression resolution, parameter and semantic-content normalizer failure containment, registry-bound add/update rejection before event creation, canonical JSON ordering, unit-equivalent and UUID-independent feature-content identity, dependency-slot and topology-reference mapping, exact runtime/provider identity, injected and engine-side digest validation, exact dependency-aware cache comparison, unavailable-feature suppression, owner and document isolation, host-generated draft identity, multi-command preview and commit, whole-DAG-validated feature add/update/removal/suppression with deterministic replay and tamper rejection, inactivity renewal and expiry, idempotent discard, count limits, duplicate command rejection, concurrent operation serialization, stale atomic commit retention, generic variable/sketch/feature event persistence acceptance, and contained port failure. Application rebuild tests additionally cover asynchronous dependency sequencing, ordered canonical geometry requests, clean-result and geometry reuse, variable-driven descendant invalidation, equivalent-expression reuse, parameter-expression failure containment, independent-branch continuation, stale-geometry exclusion, and fail-closed previous-geometry validation. Persisted-session tests add save-before-rebuild ordering, atomic storage rollback, saved-state retention after worker failure, rebuild retry, read-only lease fallback and export, clean close, and recovery-boundary validation. Component tests separately cover the state-agnostic primitive, Boolean, sketch-dimension, and extrusion fields, disposable preview document and terminal-mesh composition, the interactive sketch canvas, native select field, their TanStack Form adapters, and controlled destructive confirmation, including raw-expression retention, ordered solid inputs, create/edit identity, adjacent validation, variable resolution, focus recovery, centered and placement-state preservation, duplicate-input rejection, cycle-candidate filtering, asynchronous double-submission protection, dependency blocking, and failure persistence. Real-browser harnesses send committed and disposable preview documents through document protocol v17, run variable resolution, the domain DAG, application coordinator, and OCCT engine within the document worker, then prove clean reuse, hard worker replacement, semantic recovery under a new generation, interrupted IndexedDB reload recovery, clean save/reopen of the same variable-driven Boolean model, product-shell creation, interactive sketch drawing, constraints, variable-driven dimensions, connected-line Offset preview and signed solver reversal, local undo/redo, profile selection, exact unsaved extrusion preview and cancellation, editing, deletion, rebuild, and reopen of sketches, positioned Boxes, positioned Cylinders, and ordered Boolean/Subtract features, native ownership pruning, and deterministic multi-object 3MF plus exact STEP/binary STL download from multiple terminal bodies. Resource URI mapping, richer expressions, broader geometry eligibility, idempotent replay results, persistent caches, committed document undo/redo, configurable print-quality export profiles and reports, interactive primitive placement manipulators and rotation, automation-host confirmation, pairing, and browser disconnect behavior stay open until their executable contracts exist.

The first MCP bridge additionally requires:

- protocol initialization, capability negotiation, tool/resource discovery, structured output, progress, cancellation, and clean stdio framing;
- authenticated explicit browser pairing, exact-origin validation, session revocation, document scoping, rate limits, and hostile DNS-rebinding or cross-origin fixtures;
- host-owned confirmation for writes and destructive effects even when tool annotations or client behavior are incorrect;
- tool-list removal and draft invalidation when a contributing extension is disabled or revoked;
- an offline real-client E2E that creates, previews, commits, and undoes one deterministic feature without partial state.

Do not claim MCP support from schema snapshots or an Inspector-only demonstration. The gate requires a real paired browser, the normal worker boundary, persistence, recovery behavior, and one external client.

## Release gates

Release is blocked by:

- data loss or corruption;
- silent topology remapping in any fixture;
- export that does not open in the release matrix;
- uncontrolled worker or main-thread crash on valid input;
- missing license notice or source offer;
- migration without a fixture and backup path;
- P0 accessibility blocker;
- unexplained major memory or performance regression;
- executable extension support without an accepted sandbox result, deterministic version lock, permission revocation, and non-destructive restricted mode;
- advertised MCP write support without accepted pairing, draft isolation, confirmation, revision, cancellation, provenance, and real-client E2E evidence.
