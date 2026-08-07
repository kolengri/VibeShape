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
- independent manual open in FreeCAD or another available reader.

### STL and 3MF

- Binary STL facets, endianness, and header edge cases.
- Non-manifold import.
- 3MF OPC relationships, XML schema, and resource IDs.
- Components, transforms, and units.
- Independent slicer open.
- Dimension comparison after slicer import.
- Malicious XML and ZIP inputs with no external entity or network access.

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
| Worker cold initialization | Under 5 s |
| Simple feature preview | p95 under 500 ms |
| Rebuild 50-feature bracket corpus | Under 5 s |
| Viewport with 500k triangles | Target 60 fps, minimum 30 fps |
| Typical domain autosave transaction | Under 100 ms |
| Open a 20 MiB semantic project without cache | Under 3 s plus rebuild |

Budgets change only through benchmark evidence or an ADR. CI detects major regressions; stable performance runs use controlled hardware rather than shared runners alone.

## Browser matrix

- Chromium stable: E2E subset on every PR.
- Firefox stable: core subset on every PR.
- WebKit automation: smoke test on every PR, with manual Safari before release.
- Dedicated installed-build offline/service-worker test.
- Cross-origin isolation mode only when enabled.
- Device pixel ratio 1 and 2, plus integrated and discrete GPUs where possible.

## Monorepo and toolchain checks

- `bun ci` verifies workspace manifests against `bun.lock`.
- Typecheck, lint, and test run through workspace filters and root aggregate scripts.
- Dependency-boundary tests prohibit UI imports in domain and protocol.
- Production Vite build confirms Tailwind discovery across `apps/web` and `packages/ui`.
- shadcn component updates pass typecheck, both themes, and keyboard E2E.
- CI Bun pin matches `packageManager`; an incompatible local version fails with a clear error.

## Security fuzzing

- Schema fuzzing for commands and native files.
- ZIP and XML fuzzing.
- STEP and STL parser corpus with timeouts.
- Huge counts, NaN, Infinity, and integer overflow.
- Worker crash and restart.
- Content Security Policy test.
- Dependency audit and SBOM.
- No-network privacy test while offline.

## Release gates

Release is blocked by:

- data loss or corruption;
- silent topology remapping in any fixture;
- export that does not open in the release matrix;
- uncontrolled worker or main-thread crash on valid input;
- missing license notice or source offer;
- migration without a fixture and backup path;
- P0 accessibility blocker;
- unexplained major memory or performance regression.
