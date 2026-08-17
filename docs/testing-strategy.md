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

SPK-002 implements the native baseline through `bun run solvespace:evidence`: 17 P0 constraint fixtures receive 100 deterministic perturbations each, the canonical dragged line receives 100 larger perturbations, conflicting dimensions return handles, a zero-length line stays finite, 1,000 create/solve/dispose cycles verify the post-corpus heap plateau, and the raw ABI repeats its fixture corpus inside a Chromium module worker. The production suites additionally validate every domain constraint family and semantic entity reference, deterministic sketch command replay, pure Point/Line/Midpoint Line/corner Rectangle/Center Rectangle/Aligned Rectangle/Centered Aligned Rectangle/center-point Circle/three-point Circle/Center-point Ellipse/center-point Arc/three-point Arc/Tangent Arc/Straight Slot/Centered Slot/selected-line Slot editing operations, analytical point/line/arc/circle/ellipse Mirror and Transform cases, deterministic existing-point/midpoint/segment-intersection/point-on-line/direction/tangent inference, spatial candidate filtering equivalent to full inference across 1,000 distant points and lines, cascade deletion, variable-dimension compilation, exact worker state, complete transient-draft forwarding, stable-ID continuation and drag precedence, conflict mapping, and rebuild-before-retry recovery. Ellipse compiler fixtures require two solver-owned axis lines, one internal Perpendicular equation, no authored constraint mapping, and five unconstrained degrees of freedom. Slot fixtures require one construction centerline, two line sides, two analytical semicircular end caps, and the minimal nonredundant parallel intent accepted by SolveSpace. Profile tests cover rectangles, slots, analytical arcs, circles, and axis-aligned or rotated ellipses; exact ellipse area, bounds, and line intersections; nested holes and islands; tolerance snapping; construction exclusion; entity-order determinism; invalid solved values; bounded diagnostics; and fail-closed open, intersecting, duplicate, and degenerate geometry. Selector tests reject noncanonical or overlapping boundary intent, resolve the same stable entity sets after transient loop indices move, and return explicit missing or ambiguous outcomes instead of choosing another region. Extrusion preparation tests materialize exact line, arc, circle, and ellipse loops from solved stable IDs, cache one solve per sketch and rebuild, reject stale or missing selectors, and never persist transient indices. Domain registry tests require no dependency for New and exactly one target for Add, Remove, and Intersect while keeping schema-version-1 new-body records readable. Component tests cover the state-agnostic sketch-dimension and extrusion fields before their TanStack Form adapters, debounced draft publication, disposable preview-document composition, terminal content-hash appearance, operation and terminal-target selection, compatible-selection constraints, visible failed-constraint identity, source-expression preservation, adjacent focusable errors, async double-submit suppression, exact profile presentation, interactive selection, pointer-coordinate mapping, inference glyphs and accepted constraints, Shift suppression, exact three-stage ellipse preview and commit, both Mirror selection orders and step guidance, variable-aware exact Transform entry, affine-preserving point-snapped Transform-origin relocation, animation-frame reduction of raw drag samples, one layout snapshot per drag, inference-index prewarming and reuse across gestures, viewport-local drag frames with one release commit, exact sketch-object reuse with a separate drag target, immediate active-target rendering, adaptive bounded exact feedback during continuous movement for both ordinary and dense drafts, an incident-geometry-only drag overlay over a stable indexed base, curve/point memo boundaries, and one in-flight solve plus latest-pending coalescing. The product Playwright sketch flow creates `#width`, authors and fully constrains a real canvas rectangle, exercises local undo/redo, verifies exact SolveSpace area/perimeter, keeps the canvas height fixed while at least 96 lines populate a scroll-contained constraint panel, mirrors geometry through preselected and axis-first flows with exact solver feedback, transforms a selection through the precise project-unit-aware form, and drags a physical endpoint with a bounded visual response and stable final solve state. It separately verifies grouped family selection; Midpoint Line and Three-point Circle previews and intent; Center Rectangle preview, construction spokes, and non-over-constrained `DoF 4`; Three-point Arc circumcircle preview and positive-sweep persistence; Aligned Rectangle perpendicular/parallel intent; Centered Aligned Rectangle center-axis/midpoint intent; Tangent Arc endpoint/tangent intent and return to Line; Straight and Centered Slot analytical outlines; selected-line Slot construction conversion; automatic perpendicular and midpoint persistence with Shift suppression; and one-step local history. The flow finishes despite double activation, refactors the variable-backed dimension, removes and recreates a dimension, reloads IndexedDB state, restores authored expressions, and runs in Chromium, Firefox, and WebKit. The extrusion flow carries that stable selected profile into a symmetric new-body feature, verifies exact unsaved create and edit previews before any new document revision, cancels without mutation, edits the variable, confirms authoritative geometry, and restores the expression, selector, and symmetric state after reload. The geometry-worker Chromium harness independently verifies the exact `3,600 mm³` prism, exact Add, Remove, and Intersect volumes, bounds, meshes, and native ownership against a box target, plus an exact `π × 5 × 10 × 12 mm³` ellipse prism with semantic topology and disposal. The lower-level harness still loads the promoted generated WASM through the real document worker, solves a variable-driven fully constrained line and a `#width` by `#height` rectangular profile, performs two continuation drags, and requires a 1,000-point sketch to solve in less than 2 seconds with no more than 64 MiB of WASM heap. `bun run solvespace:build` and extended native evidence reject truthy `CI`; the production build and browser harness run locally before merge.

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

- Unit tests verify zero-copy typed-array binding, projection fallback, friendly face ordinals, and exact extraction of every triangle belonging to a rendered face.
- React component tests verify lazy adapter ownership, terminal-mesh filtering, face and origin-plane callback wiring, empty-model datum initialization, initial and explicit fit behavior, camera preservation across mesh replacement, sketch continuation and drag-target forwarding, last-valid solved-display retention, disposal, and localized renderer failure containment.
- Playwright creates a real persisted variable-driven Box, waits for measured WebGL2 canvas output, selects a rendered face through an actual pointer click, observes the accessible feature-and-face summary, and clears it through the visible control. A primary-button drag must change the real WebGL canvas without activating a sketch plane. The sketch flow scans real canvas preselection state, clicks an XY origin plane through Three.js raycasting, and separately proves the synchronized keyboard-equivalent native select path.
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
- I18n tests cover locale resolution, base-language fallback, blocked preference storage, runtime switching, document language/direction, duplicate namespace ownership, and exact English key/placeholder parity for every added locale.
- CI Bun pin matches `packageManager`; an incompatible local version fails with a clear error.

The automatic pull-request workflow is one Linux job: frozen install, skill validation, format, lint, typecheck, unit tests, critical dependency audit, and uncached Fallow audit. Production build, all Playwright suites, native builds, and spike evidence are local merge gates. The workflow does not run again on `main`.

Fallow complements but does not replace Biome, TypeScript, dependency CVE scanning, executable boundary tests, or behavior tests. CI checks out full history for merge-base detection, runs the new-only gate without an analysis cache, and distinguishes exit code `1` findings from exit code `2` configuration or runtime failures.

The foundation scaffold implements these gates as root Bun scripts. Vitest discovers TypeScript and TSX tests across workspaces and build scripts, including jsdom-backed component tests. The automatic pull-request workflow performs a frozen install, skill validation, formatting, linting, typechecking, unit tests, critical dependency audit, and uncached Fallow audit in one job. A superseding commit cancels the older run, and the squash-merged tree is not run again on `main`.

The domain feature-graph suite verifies presentation versus evaluation order, duplicate and missing identities, cycles, declared topology dependencies, canonical scheduling serialization, first-run asynchronous evaluation, transitive dirty propagation, independent cache reuse, suppression, dependent-only failure blocking, independent branch progress, stable rejected-evaluator containment, and fail-closed dirty/cache inputs. Application tests cover committed-document validation, automatic root derivation, presentation-only reuse, ordered canonical geometry requests, complete rebuild-state validation, document and revision binding, worker-generation recovery, environment and mesh-policy invalidation, descendant-only rebuild, independent branch continuation, adapter-environment mismatch, and stale-geometry exclusion. Persisted-session unit tests prove save-before-rebuild sequencing, no state or rebuild advance after an atomic storage failure, saved semantic retention across worker failure, retry, read-only lease fallback, read-only export, clean close, and invalid-boundary rejection. Protocol conformance proves that domain identities and the dependency-independent worker serialization are byte-identical; protocol-v8 tests reject reordered hashes, missing slots, and duplicate dependency feature IDs, while document-protocol-v8 tests also reject envelope/snapshot drift, invalid display units, variable or sketch tables, invalid compound Offset pairs, mismatched transient drafts, stale solve state, unknown fields, oversized payloads, mismatched solution identities, and empty export transfers. Document-worker tests cover incremental state ownership, clean reuse, changed-descendant rebuild, cross-document isolation, stale queued generations, transferable mesh clones and export files, successful-terminal-body selection, print-mesh identity enforcement, deterministic 3MF packaging, stale and empty export rejection, disposal, health, invalid responses, duplicate request IDs, complete response-envelope matching, worker error and message-failure rejection, serialized session operations, retry classification, generation increments, and rebuild-before-solve-or-export recovery from the last successful semantic snapshot. Geometry-worker tests continue to cover environment and digest rejection before engine execution, typed geometry failures, logical cancellation, exact feature-cache reuse, transactional replacement, failed cleanup visibility, ordered dependency resolution, document isolation, and deterministic temporary compound ownership. The primitive feature Playwright scenario executes the actual worker and OCCT in every target browser and verifies shape, topology, mesh, cache, rollback, ownership, and disposal invariants. The feature rebuild scenario sends a committed document through the browser document-worker session, proves zero OCCT evaluations for a clean rebuild, terminates the worker, proves a full recovery rebuild under the next generation, and then evaluates only a changed cylinder plus its Boolean descendant. The document export scenario creates product-shell bodies, verifies direct 3MF/STEP/STL downloads, remembers a preferred slicer across reload, proves an unavailable bridge downloads the already generated 3MF with accurate copy, and intercepts one exact authenticated loopback request containing the 3MF bytes in Chromium, Firefox, and WebKit. Bridge unit tests separately cover exact-origin pairing and rotation, portable metadata, credentials, rate and single-flight policy, request deduplication, owned temporary files, no-shell executable arguments, unavailable slicers, and path-free failures. The persisted rebuild scenario creates a variable-driven Boolean model through ordinary commands, commits every revision to IndexedDB, reloads without a clean close, recovers and rebuilds revision 5, closes cleanly, and reopens the same geometry in Chromium, Firefox, and WebKit. Persisted Boolean topology lineage remains a later integration suite.

The product Variables scenario opens the real browser document controller, creates and evaluates a raw table row, applies the whole table through a transaction-tagged persisted draft, reloads the page, and verifies the same authored and resolved values. It also creates a second row, filters the shared autocomplete from a partial `#name`, and inserts the authored token with the keyboard. The sketch-first scenario starts from the primary empty-document action, finishes one asynchronous constrained rectangle command despite double activation, retains the saved profile as the selected sketch, proves that tree activation selects without editing, and enters editing only through the explicit action. The shell command scenario verifies application-bar palette opening, dialog focus restoration, `Ctrl/Cmd+K`, localized keyword search, visible disabled eligibility, command-driven sketch creation, and safe shortcut-driven tool activation in Chromium, Firefox, and WebKit. Registry unit tests reject descriptor/handler duplication, missing and orphaned entries, and owner drift; component tests cover filtering, keyboard selection, recent-command persistence, text-input shortcut safety, `Escape` cancellation, and shared toolbar eligibility. The Extrusion scenario then proves contextual eligibility, carries the selected stable profile into a variable-driven new-body feature, shows exact disposable create and edit previews while the feature tree remains unchanged, cancels one edit back to committed geometry, rebuilds exact authoritative geometry, edits it, and reopens the same intent. The Box scenario completes a partial `#variable` token through the secondary direct-solid path, persists and rebuilds the feature, verifies that one terminal feature reaches a measured WebGL2 canvas and Fit view action, activates the Box from the feature tree, retains the variable source while updating another dimension through the ordinary feature-update command, and verifies both values after reload. It then explicitly renames the committed variable, verifies that the Box source changed from the exact old token to the new token without losing geometry, and reloads again to prove the refactor was persisted. The Cylinder scenario creates a centered feature with a variable-driven radius, edits its height through the same ordinary feature-update path, reloads the page, and verifies the authored sources and centered state. The Boolean/Subtract scenario creates one Box and two Cylinders, verifies command eligibility, persists a target-then-tool cut, switches the tool through feature update, checks terminal rendered-feature counts, and reloads to prove ordered dependency restoration. It then proves dependent-input deletion is blocked with a visible owner, double-activated destructive confirmation commits once, terminal geometry is restored after removing the Boolean, an independent primitive can be deleted, and both removals survive reload. Component coverage separately proves the state-agnostic Variables table, primitive panel, native select, and variable-expression combobox contracts plus their TanStack integrations; caret-local token replacement; self-suggestion exclusion; keyboard and pointer completion; toolbar ordering and profile-driven Extrude eligibility; Box, Cylinder, and Boolean create/edit identity; source-expression and dependency-order restoration; cycle-candidate filtering; tree activation by stable identity; focused invalid controls; localized adjacent validation; async double-submit suppression; destructive confirmation settlement; terminal-feature filtering and preview appearance; imperative viewer lifecycle ownership; and empty-state behavior. Domain tests prove stable variable and feature IDs, dependency-safe feature removal, exact-token refactoring, arbitrary-string preservation, expression-limit rejection, atomic command replay, and tamper rejection. Viewer-package tests prove direct typed-array `BufferGeometry` binding, retained triangle-to-face metadata, measured bounds, disposal events, and finite orthographic frusta.

Production Vite build, the Chromium/Firefox/WebKit shell and OCCT E2E suite, controlled native builds, memory and performance evidence, FreeCAD STEP validation, compliance bundles, topology, slicer, persistence, and extension corpora are local pre-merge gates. Generated evidence stays under `.artifacts`. Heavy entry points reject a truthy `CI` environment and have no GitHub Actions workflow.

The current executable evidence covers the foundation shell; the document-worker-owned graph rebuild and 3MF/STEP/STL export coordinator, remembered-slicer fallback and authenticated loopback handoff, in-memory worker replacement and semantic recovery, and real-browser OCCT path; the application persisted-session contract and persistence-backed page reload plus clean save/reopen rebuilds; deterministic `.vshape` v0 semantic round-trip and fresh-storage browser import; additive IndexedDB preview-store migration with prior-data retention; deterministic bounded terminal-mesh SVG previews; new-project creation, local-project switching with semantic rebuild, replay-verified duplication with variable/source and preview preservation, and confirmed inactive-project deletion across reload; document protocol v8 with project display units, authored variables, analytical sketches, exact-revision committed and transient-draft solving, deterministic profile results, and export; production sketch schema and replay; exact SolveSpace runtime hashes; variable-backed dimensions and signed connected-line Offset; stable-ID continuation and drag precedence; worker recovery; and a real-WASM variable-driven rectangular profile plus 1,000-point browser budget; the protocol-v8 box, cylinder, and dependency-aware Boolean/Subtract boundary; SPK-001 worker ownership, operations, memory, performance, exchange, and restart; SPK-003 semantic and composed topology resolution; SPK-004 deterministic 3MF and slicer invariants; SPK-005 transactional recovery and offline fallback; and the reduced-scope SPK-006 package and isolation boundary. It does not yet prove general interior-intersection splitting, stable persisted profile selectors, document-integrated topology repair, a complete production CAD workflow, active-project deletion UX, a real two-build service-worker update, `.vshape` migrations or same-ID restore, persistent derived-cache promotion, signed slicer-bridge distribution, installed-build release behavior, configurable print-quality export profiles and reports, placement, or production extension execution.

Extended OCCT lifecycle runs are parameterized without slowing the normal PR matrix:

```bash
VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS=1000 \
VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES=5 \
bun run test:e2e -- --project=chromium tests/e2e/geometry-worker.spec.ts
```

The current controlled allocator plateau, executable ceilings, and hard-restart baseline are documented in [SPK-001 evidence](spikes/spk-001-occt-worker.md).

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

The current conformance fixtures cover strict input rejection, exact-revision reads, bounded semantic summary output, cursor-paginated evaluated-variable output, command and feature-type descriptor-handler parity, command rejection on active feature-type composition drift, exact feature-type identity and unavailable-type preservation, canonical metric/imperial/angle/scalar normalization, variable syntax and unit parsing, forward and backward dependencies, cycle and missing-reference rejection, dimensional arithmetic, revisioned variable mutation and tamper-resistant replay, referenced-variable deletion protection, bounded box/cylinder and Boolean/Subtract parameter validation, trusted parameter-expression resolution, parameter and semantic-content normalizer failure containment, registry-bound add/update rejection before event creation, canonical JSON ordering, unit-equivalent and UUID-independent feature-content identity, dependency-slot and topology-reference mapping, exact runtime/provider identity, injected and engine-side digest validation, exact dependency-aware cache comparison, unavailable-feature suppression, owner and document isolation, host-generated draft identity, multi-command preview and commit, whole-DAG-validated feature add/update/removal/suppression with deterministic replay and tamper rejection, inactivity renewal and expiry, idempotent discard, count limits, duplicate command rejection, concurrent operation serialization, stale atomic commit retention, generic variable/sketch/feature event persistence acceptance, and contained port failure. Application rebuild tests additionally cover asynchronous dependency sequencing, ordered canonical geometry requests, clean-result and geometry reuse, variable-driven descendant invalidation, equivalent-expression reuse, parameter-expression failure containment, independent-branch continuation, stale-geometry exclusion, and fail-closed previous-geometry validation. Persisted-session tests add save-before-rebuild ordering, atomic storage rollback, saved-state retention after worker failure, rebuild retry, read-only lease fallback and export, clean close, and recovery-boundary validation. Component tests separately cover the state-agnostic primitive, Boolean, sketch-dimension, and extrusion fields, disposable preview document and terminal-mesh composition, the interactive sketch canvas, native select field, their TanStack Form adapters, and controlled destructive confirmation, including raw-expression retention, ordered solid inputs, create/edit identity, adjacent validation, variable resolution, focus recovery, centered-state preservation, duplicate-input rejection, cycle-candidate filtering, asynchronous double-submission protection, dependency blocking, and failure persistence. Real-browser harnesses send committed and disposable preview documents through document protocol v8, run variable resolution, the domain DAG, application coordinator, and OCCT engine within the document worker, then prove clean reuse, hard worker replacement, semantic recovery under a new generation, interrupted IndexedDB reload recovery, clean save/reopen of the same variable-driven Boolean model, product-shell creation, interactive sketch drawing, constraints, variable-driven dimensions, connected-line Offset preview and signed solver reversal, local undo/redo, profile selection, exact unsaved extrusion preview and cancellation, editing, deletion, rebuild, and reopen of sketches, Boxes, Cylinders, and ordered Boolean/Subtract features, native ownership pruning, and deterministic multi-object 3MF plus exact STEP/binary STL download from multiple terminal bodies. Resource URI mapping, richer expressions, broader geometry eligibility, idempotent replay results, persistent caches, committed document undo/redo, configurable print-quality export profiles and reports, placement, automation-host confirmation, pairing, and browser disconnect behavior stay open until their executable contracts exist.

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
