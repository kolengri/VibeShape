---
name: vibeshape-testing
description: Design, add, or review VibeShape tests for domain commands, geometry invariants, sketch solving, topology references, worker protocols, persistence, native files, STEP/STL/3MF exchange, browser behavior, and accessible UI. Use whenever runtime behavior changes, a bug needs regression coverage, test files are edited, or the correct test layer is uncertain.
---

# VibeShape Testing

Read `docs/testing-strategy.md` and the architecture document for the affected subsystem. Test the invariant at the lowest layer that owns it; do not replace domain or geometry evidence with screenshots.

## Select the Test Layer

| Change | Required focus |
|---|---|
| Pure domain, units, DAG, commands | Deterministic unit and property tests |
| Sketch solver | Residuals, degrees of freedom, conflicts, degeneracies, repeatability |
| Geometry adapter or feature | Shape validity, counts, metrics, failure kind, ownership, and disposal |
| `TopoRef` | `resolved`, `ambiguous`, and `missing`; zero silent wrong matches |
| Worker protocol | Runtime schemas, revisions, transferables, stale generations, cancel, restart |
| Persistence and `.vshape` | Transactions, recovery, migrations, corruption, limits, missing caches |
| STEP, STL, or 3MF | Formal validity, round-trip invariants, malicious input, independent reader |
| Viewer | Selection mapping, buffer ownership, disposal, performance budgets |
| UI command | Preview, Apply, Cancel, undo boundary, failure state, keyboard, focus |
| PWA and offline | Install/update lifecycle, offline reopen, storage failure, fallback flows |

## Required Cases

- Happy path and the smallest valid input
- Empty, missing, boundary, non-finite, and malformed inputs accepted by the boundary
- Permanent failure with a typed, actionable diagnostic
- Cancellation and stale-result behavior for asynchronous work
- Reopen, rebuild, undo, and redo when document state changes
- Worker crash and recovery when worker-owned state changes
- Memory and resource cleanup for kernel, renderer, or large-buffer work
- Regression fixture for every corrected bug

## Geometry Rules

- Assert invariants such as validity, volume, area, bounding box, topology role, and tolerances.
- Never require B-Rep byte equality, stable face order, stable edge order, or exact triangle order.
- Cover a parameter matrix, not only one aesthetically plausible model.
- Treat a confident wrong `TopoRef` result as more severe than an explicit ambiguity.
- Record engine and solver build identifiers with golden fixtures.

## Conventions

- Use Vitest for TypeScript unit, property, contract, and adapter tests unless a spike documents a Bun-test requirement.
- Use Playwright for real browser, worker, PWA, accessibility, and end-to-end workflows.
- Co-locate focused tests according to the neighboring package convention.
- Prefer behavior assertions over implementation details and snapshot-only tests.
- Keep fixtures minimal, deterministic, licensed, and versioned.
- Use independent tools or slicers for interoperability claims.

## Verify

Run the owning workspace's focused test first, then use `vibeshape-verify-scope`. Before merge, run the full release-relevant corpus for changes to geometry, solver, topology, storage, formats, or engine versions.
