---
name: vibeshape-local-diagnostics
description: Diagnose local VibeShape runtime failures from terminal and browser evidence before changing code. Use when the dev server crashes or hangs, the browser shows an error or stale UI, a CAD command appears to do nothing, a worker or WASM operation fails, persistence or reload behaves incorrectly, or a user says a local workflow still does not work.
---

# VibeShape Local Diagnostics

Start from the failing runtime, not a code guess. Preserve the document and the smallest reproducible
workflow while locating the first layer that violated its contract.

## Collect Evidence in Order

1. Reproduce the exact user action when it is safe and deterministic.
2. Read the active development-terminal output first. When running in Codex desktop, use the current
   task terminal reader before starting a second server.
3. Capture the first causal error, owning process or worker, operation, diagnostic code, stack frame,
   document revision, and worker generation when present.
4. For browser-visible failures, inspect the console, failed network or module requests, worker and
   service-worker state, and the relevant DOM status. Use Playwright only when it can reproduce the
   same workflow without erasing the user's browser state.
5. Trace the first meaningful stack frame into the owning source and follow one boundary outward to
   the caller. Do not begin from later cascading errors.

If the evidence is missing, state exactly which runtime signal is unavailable. Do not fabricate a
cause from nearby code.

## Classify the Failing Layer

Distinguish these contracts before editing:

- React command or form state;
- semantic document command and revision;
- document-worker protocol or stale generation;
- SolveSpace sketch solve or profile extraction;
- OCCT rebuild, selector resolution, or mesh generation;
- Three.js rendering, camera, picking, or resource disposal;
- IndexedDB transaction, recovery, migration, or project switching;
- Vite module loading, PWA cache, or service-worker update;
- extension host, slicer handoff, or another optional boundary.

A successful semantic commit followed by a failed derived rebuild is not a failed button. A valid
mesh that is not visible is not a geometry failure. Preserve those distinctions in the diagnosis.

## Fix Narrowly

- Change the layer that owns the violated invariant; avoid compensating in the UI for a worker,
  domain, persistence, or geometry failure.
- Preserve typed diagnostics and original causes across boundaries.
- Do not clear IndexedDB, caches, service workers, generated evidence, or the user's project merely
  to make the symptom disappear. Obtain explicit approval before destructive recovery.
- Do not replace a reproducible failure with a broad dependency reinstall, engine rebuild, or
  refactor unless evidence points there.
- When the request is diagnosis-only, report the cause and proposed fix without implementing it.

## Verify the Original Workflow

Re-run the exact failing action and assert the layer-specific result, not only the absence of a log
line. Add a regression test at the narrowest stable production boundary that reproduces the bug.
Use `vibeshape-testing` for test design and `vibeshape-verify-scope` for the remaining checks.
