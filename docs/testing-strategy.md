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

- One fixture for each constraint.
- Constraint combinations and fully defined canonical sketches.
- Over-constrained inputs with the expected conflict set.
- Under-constrained inputs and degrees of freedom.
- Near-degenerate geometry.
- Scale from very small to large parts.
- Drag continuation without branch-solution jumps.
- Random perturbations and residual thresholds.
- Deterministic results for the same input and build.

SPK-002 implements this baseline through `bun run solvespace:evidence`: 15 P0 constraint fixtures receive 100 deterministic perturbations each, the canonical dragged line receives 100 larger perturbations, conflicting dimensions return handles, a zero-length line stays finite, 1,000 create/solve/dispose cycles verify the post-corpus heap plateau, and the raw ABI repeats its fixture corpus inside a Chromium module worker. `bun run solvespace:build` and the evidence command reject truthy `CI`; ordinary PR tests exercise only the fast TypeScript adapter with a fake native module.

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

- round-trip every schema version;
- forward-compatible unknown optional field;
- unknown required capability;
- sequential migrations;
- missing or corrupt cache does not affect semantic open;
- checksum corruption;
- duplicate path, traversal, and ZIP-bomb limits;
- truncated-journal recovery;
- old fixture corpus in every release.

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
- I18n tests cover locale resolution, base-language fallback, blocked preference storage, runtime switching, document language/direction, duplicate namespace ownership, and exact English key/placeholder parity for every added locale.
- CI Bun pin matches `packageManager`; an incompatible local version fails with a clear error.

The automatic pull-request workflow is one Linux job: frozen install, skill validation, format, lint, typecheck, unit tests, critical dependency audit, and uncached Fallow audit. Production build, all Playwright suites, native builds, and spike evidence are local merge gates. The workflow does not run again on `main`.

Fallow complements but does not replace Biome, TypeScript, dependency CVE scanning, executable boundary tests, or behavior tests. CI checks out full history for merge-base detection, runs the new-only gate without an analysis cache, and distinguishes exit code `1` findings from exit code `2` configuration or runtime failures.

The foundation scaffold implements these gates as root Bun scripts. Vitest discovers TypeScript and TSX tests across workspaces and build scripts, including jsdom-backed component tests. The automatic pull-request workflow performs a frozen install, skill validation, formatting, linting, typechecking, unit tests, critical dependency audit, and uncached Fallow audit in one job. A superseding commit cancels the older run, and the squash-merged tree is not run again on `main`.

The domain feature-graph suite verifies presentation versus evaluation order, duplicate and missing identities, cycles, declared topology dependencies, first-run evaluation, transitive dirty propagation, independent cache reuse, suppression, dependent-only failure blocking, independent branch progress, stable evaluator failure containment, and fail-closed dirty/cache inputs. Geometry-backed invariants and document save/reopen remain later integration suites.

Production Vite build, the Chromium/Firefox/WebKit shell and OCCT E2E suite, controlled native builds, memory and performance evidence, FreeCAD STEP validation, compliance bundles, topology, slicer, persistence, and extension corpora are local pre-merge gates. Generated evidence stays under `.artifacts`. Heavy entry points reject a truthy `CI` environment and have no GitHub Actions workflow.

The current executable evidence covers the foundation shell; SPK-001 worker ownership, operations, memory, performance, exchange, and restart; SPK-003 semantic and composed topology resolution; SPK-004 deterministic 3MF and slicer invariants; SPK-005 transactional recovery and offline fallback; and the reduced-scope SPK-006 package and isolation boundary. It does not yet prove broad hostile import corpora, document-integrated topology repair, production CAD workflows, a real two-build service-worker update, `.vshape` round-trip, installed-build release behavior, or production extension execution.

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

The current conformance fixtures cover strict input rejection, exact-revision reads, bounded semantic summary output, descriptor-handler parity, owner and document isolation, host-generated draft identity, multi-command preview and commit, inactivity renewal and expiry, idempotent discard, count limits, duplicate command rejection, concurrent operation serialization, stale atomic commit retention, and contained port failure. Pagination, derived views, geometry validation, progress, cancellation, idempotent replay results, durable persistence, undo/redo, confirmation, pairing, and browser disconnect behavior stay open until their executable contracts exist.

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
