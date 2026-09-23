# Print preparation and CAD usability plan

## Status and scope

This document records the current print-preparation slice and the next usability gates for
VibeShape. The status below is based on source inspection on 2026-09-23 and is not a substitute for
a moderated usability study, a physical print, or a slicer release matrix.

The user request is for detachable fin-style supports inspired by the
[reference video](https://www.youtube.com/watch?v=WGsi5SCurpM&t=20s). The relevant video segment and
[PrintFins FIN-SPEC](https://github.com/gittrahan/support-fins/blob/main/docs/FIN-SPEC.md) MIT material were inspected as product
inspiration. No upstream code is copied, and this document does not claim that the video and the
current implementation are geometrically identical.

VibeShape owns the design model, bounded print analysis, derived print preparation, and 3MF export.
A slicer remains responsible for toolpaths, printer profiles, G-code, and the final manufacturing
decision. See [3D-printing workflow](../3d-printing.md) and [ADR-0006](../adr/0006-3mf-primary-print-export.md).

## Current vertical slice

The current flow is **Export → Prepare print / breakaway fins**:

1. The document worker exports the exact terminal body meshes through the existing print-mesh path.
2. `@vibeshape/print-analysis` creates a disposable print copy. It rotates around X/Y, centers the
   copy over the XY build area, and seats its lowest point at Z=0. Design coordinates and semantic
   history are not changed.
3. For one convex, closed body, selected sloped facets can receive up to two coplanar comb-prism
   fins. Horizontal tine contacts are aligned to the requested layer height and include clearance.
4. The result contains the original print bodies plus separate fin meshes, a bounded report, and
   warnings. The preview is disposable and settings are session-only.
5. The user can inspect the result in the browser, download the prepared 3MF, or send that same
   prepared file through the paired desktop slicer handoff. The original export path remains
   available by toggling back to the ordinary export view.

Relevant owners and entry points:

- Geometry and export boundary: `packages/document-worker/src/runtime.ts` and
  `packages/geometry-worker/src/engine.ts`.
- Print preparation: `packages/print-analysis/src/index.ts`, `fin-supports.ts`,
  `mesh-geometry.ts`, and `profile-mesh.ts`.
- Protocol validation: `packages/protocol/src/print-preparation.ts` and
  `packages/protocol/src/document-worker.ts`.
- UI workflow: `apps/web/src/document/document-export-dialog.tsx`,
  `apps/web/src/printing/print-preparation-panel.tsx`, and
  `apps/web/src/printing/print-preparation-preview.tsx`.
- Focused domain tests: `packages/print-analysis/src/index.test.ts` and
  `apps/web/src/printing/print-preparation-panel.test.tsx`.

The implementation deliberately fails closed for unsupported inputs. It transforms the model but
adds no fins, with an explicit warning, for multiple bodies, non-convex/open bodies, excessive
complexity, unsuitable facets, or unsafe contacts. Supported preparations still report partial
coverage. Independent PrusaSlicer and Bambu Studio `--info` checks establish manifold positive-volume
mesh/bounds evidence for the checked fixture; they do not establish successful slicing, toolpaths, or
printing.

## Boundary and invariants

Print preparation is a first-party print-analysis capability, not a new modeling feature. It must:

- operate on validated, revision-bound export meshes;
- remain outside the semantic feature DAG, document history, and design-coordinate system;
- produce deterministic, bounded, disposable output;
- preserve every source body even when support generation is unavailable;
- emit separate, watertight, positive-volume support meshes;
- report partial coverage and unsupported cases instead of silently guessing;
- use the ordinary worker/protocol/export path rather than mutating the document or bypassing 3MF
  validation.

Persisted print setups, printer profiles, placement transforms, and reports are future derived
configuration. They must not become CAD feature parameters or change STEP/ordinary STL semantics.

## High-impact usability findings

### Orientation is numeric, not graphical

The current preparation form exposes X/Y angles and numeric support parameters. It does not yet let a
user select a face and say “place this face on the bed”, inspect the contact plane, or manually move a
body in a bed view. A 45-degree default is a useful bounded starter, but it is not a reliable answer
for arbitrary parts.

### Support coverage is intentionally narrow

Only one convex closed body is eligible for fin generation, with at most two coplanar fin sites.
Concave bodies, open meshes, multiple bodies, and collisions between independent support sites are
reported as unsupported. This is the right fail-closed behavior for the first slice, but the UI must
keep the warning visible and must not imply full automatic support coverage.

### Printer and manufacturing context is absent

There is no printer/build-volume profile, bed-shape check, overhang heatmap, thin-wall rule, or
independent slicer evidence in the preparation panel. The prepared bounds are useful derived data,
but they do not prove that a model fits a particular printer or will slice successfully.

### Preparation settings are not durable

The current parameters are session-only. Closing the panel or changing the project does not create a
recoverable print setup. This is acceptable for the disposable preview slice; persistence should be
added only with an explicit derived-print-setup contract and migration plan.

## Delivery plan

### P0: delivered bounded flow and regression gates

- Keep the current delivered single-body convex fin generator behind strict schemas and resource
  limits.
- Show the prepared bounds, body/fin/contact counts, and every warning next to the preview.
- Label the output as a prepared 3MF and retain the “verify in a slicer” message.
- Add a clear “no suitable support” state without blocking download of the original valid body mesh.
- Retain cancellation and stale-revision checks for every worker preparation request.
- Cover deterministic output, input immutability, manifold/positive-volume fins, layer-aligned
  contacts, unsupported geometry, malformed inputs, and panel close/reopen behavior.

The export audit also corrected stale failure messages after reopening the dialog, released the
pending state after unexpected export failures, and bound export filenames and completion to the
captured source session and revision. Prepared mode hides original-model export actions so the
visible supported model and the downloaded or handed-off file cannot be confused.
The normal slicer action now also catches a rejected preparation request and replaces its pending
message with a recoverable error, rather than leaving the user waiting indefinitely.

### Broader CAD audit: confirmed next slices

This was a bounded source and export-flow audit, not an exhaustive usability study of the CAD.
Body picking and graphical edge-treatment picking already exist; do not treat older roadmap copy
as evidence that those interactions are missing.

- **Project recovery:** importing a backup whose document ID already exists only reports a conflict.
  Offer an explicit **Import as new project** action using the existing complete-history copy
  primitive. Never overwrite the existing project. Test journal remapping, reference preservation,
  immutable source data, quota failure, and checkpoint/read-only refusal before delivery.
- **Curved sketch authoring:** spline authoring and non-analytical edge Use remain unsupported.
  Establish exact curve, solver, reference-identity, and profile contracts before adding a toolbar
  button. Test source edits and reopen; a sampled visual curve is not an associative CAD curve.
- **Selection discoverability:** reconcile the older feature matrix with current body/edge picking,
  then evaluate a unified selection-filter workflow with real sketch and feature tasks. Do not
  replace existing graphical interactions based on documentation alone.

These are follow-up slices, not regressions fixed by the print-support patch. Active-project deletion
continues to be refused intentionally; removing that safety boundary is not part of this plan.

### P1: orientation and inspection

- Add a graphical bed preview with explicit Z-up, bed plane, body bounds, and fin visibility.
- Add face-on-bed orientation for a selected planar face, with a manual rotation fallback.
- Display overhang candidates and support contacts as selectable overlays, without pretending that
  the overlay is a slicer simulation.
- Add a per-body visibility toggle and a way to disable or regenerate fins before download.

### P1: broader safe support coverage

- Support multiple bodies only after independent-body collision and bed-contact rules exist.
- Add concave-body analysis using a bounded layer/visibility method; retain explicit “partial” or
  “unsupported” diagnostics when coverage cannot be proven.
- Replace the fixed two-site heuristic with a deterministic support-site budget and stable derived
  site identifiers. These identifiers remain print-setup identities, never topology persistence.
- Add calibration fixtures for sloped fins, disconnected bodies, narrow contacts, and near-limit
  meshes.

### P2: printer-aware preparation

- Add local printer/build-volume profiles containing only analysis inputs: bed shape, X/Y/Z volume,
  nozzle and nominal layer-height ranges, material/process family, and recommended design rules.
- Validate placement and prepared bounds against the selected profile.
- Add overhang, thin-wall, disconnected-shell, and estimated export-size checks with severity,
  confidence, rule, and suggested action.
- Keep vendor temperatures, speeds, acceleration, and G-code scripts in the slicer domain.

### P2: durable print setups and evidence

- Persist a versioned derived print setup separately from the CAD history, including source document
  revision, placement, profile reference, preparation parameters, and report provenance.
- Invalidate a setup when its source revision or profile changes; never silently reuse stale meshes.
- Add independent slicer compatibility fixtures and a physical calibration-print protocol before
  making claims about detachability, surface quality, load, or print success.

## Acceptance boundaries

The feature is ready for a broader preview when a user can identify the bed orientation, understand
which regions are supported and which are not, download a revision-bound prepared 3MF, and verify it
in a slicer without confusing geometric preparation with manufacturing success.

It is not ready to claim general automatic supports until multi-body collision, concavity, build
volume, and coverage limitations have explicit diagnostics and regression fixtures. It is not ready
to claim physical detachability until calibrated prints and material/process-specific evidence exist.

The broader print-check pipeline and printer profile model remain specified in
[3D-printing workflow](../3d-printing.md). The current Phase 4 roadmap also calls for adaptive
tessellation, validation profiles, build-volume checks, overhang overlays, reports, and slicer
compatibility evidence: [roadmap](../roadmap.md#phase-4--3d-printing-workflow-4--7-weeks).
