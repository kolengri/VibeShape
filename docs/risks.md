# Risk Register

## Highest-Risk Items

| ID | Risk | Likelihood | Impact | Mitigation or gate |
|---|---|---:|---:|---|
| R1 | Topological naming creates silently incorrect references | High | Critical | Semantic history, geometric signatures, ambiguity UI, and a fixture matrix before feature expansion |
| R2 | OCCT WASM is too large, slow, or prone to memory leaks | High | High | Custom bindings, a worker boundary, memory harnesses, caching, and a Phase 0 go/no-go gate |
| R3 | The sketch solver is unstable or reports conflicts poorly | High | Critical | Isolated spike, solver corpus, limited constraint set, and an explicit fallback decision |
| R4 | Browser storage is cleared or exhausted | Medium | Critical | `.vshape` export, persistent-storage request, quota UI, journal and snapshots, and bulk backup |
| R5 | Imported CAD or ZIP data crashes the application or exhausts resources | High | High | Limits, worker isolation, fuzzing, timeouts, and recovery paths |
| R6 | The 3MF writer produces formally valid files that slicers cannot use | Medium | High | Specification and conformance checks plus smoke tests in two independent slicers |
| R7 | Scope expands toward a complete Onshape replacement | High | Critical | Fixed alpha workflow, explicit non-goals, and roadmap gates |
| R8 | A WASM distribution violates LGPL or GPL obligations | Medium | Critical | Source archives, patches, builds, notices, a release gate, and legal review |
| R9 | Geometry results change after dependency updates | High | High | Exact version pins, engine build ID in files and caches, and corpus tests before upgrades |
| R10 | Mesh generation, picking, or rendering blocks the main thread | Medium | High | Geometry worker, transferable arrays, levels of detail, and profiling |

## Details

### Topological Naming

This cannot be fixed later: reference formats and feature outputs must account for topology changes from the first implemented feature. The UI should prefer datum and origin references and expose ambiguity instead of guessing.

**Stop condition:** if the spike does not achieve acceptable behavior, the alpha must limit downstream face-based features and must not promise that those references are stable.

### WASM Size, Startup, and Memory

A complete OCCT binding may be too large, while manual lifetime management for C++ wrappers is a likely source of leaks.

**Measurements:** compressed bytes, parse and compile time, first-operation latency, peak and steady-state heap usage, and repeated-operation deltas in three browsers.

**Fallback:** reduce the binding surface, lazy-load the data-exchange module, cache the compiled module, and remove simultaneous document execution.

### Solver

The complete SolveSpace web application is experimental, and extracting a solver subset may require substantial C++ work.

**Fallback order:** subset port -> another free and open-source solver -> reduced alpha constraint scope -> a custom solver as a separate project.

### Data Loss

OPFS and IndexedDB are tied to the browser origin and its storage policy. Users can clear site data.

**Rule:** internal autosave is not called a backup. The UI must distinguish between "saved locally in this browser" and "exported as a file."

### Cross-Browser Support

File System Access and PWA installation support vary. Safari and Firefox may impose different memory and worker constraints.

**Rule:** a native file picker is an enhancement; upload and download are the baseline. Chromium is not the only test target.

### Performance Cliffs

Fillets, booleans, dense STEP imports, and export-quality tessellation may take seconds or minutes.

**Mitigation:** progress stages, discard of stale generations, preview levels of detail, timeouts, diagnostics, and model-complexity warnings. Do not show fabricated percentages when the kernel cannot report real progress.

### Feature Creep

Assemblies, drawings, collaboration, and slicing are each comparable to an independent product track.

**Gate:** every new alpha feature must shorten the primary sketch-to-print workflow or eliminate a data-integrity or correctness risk.

### Licenses

GPL reduces uncertainty around solver integration but limits proprietary reuse. The OCCT LGPL still requires replaceability and a source offer even when the application itself is GPL-licensed.

**Gate:** CI builds the compliance artifact together with every release; it is not assembled manually after publication.

## Decisions with a High Cost of Change

- Stable IDs and reference format
- Document commands and events
- Native file versioning
- Geometry-engine ownership boundary
- License
- Units and coordinate system
- Local-first versus server-authoritative data model

These decisions require an ADR and fixtures before implementation. UI colors, component-library choices, and layout are reversible and must not block geometry spikes.

## Risk Review Cadence

- After each phase exit
- Before updating OCCT, Replicad, or the solver
- Before changing the native file format's major or minor version
- Before public alpha
- After any data-loss or silently incorrect geometry incident

Every closed risk must retain a link to its benchmark, test, or ADR instead of only carrying a "fixed" status.
