# Layout and viewport update audit

## Scope

This September 23, 2026 audit starts from `a75e60f7c8ee6553cbf786d80b08f1870016319f`.
It covers shared modal layout, command navigation, compact editor surfaces, and unchanged-mesh
updates. It is not an exhaustive certification of every CAD tool, accessibility requirement,
device, or model size. See the [design contract](design-and-ux-guidelines.md) for the supported
authoring envelope and the [print preparation plan](print-preparation-and-ux-plan.md) for broader
manufacturing and workflow gaps.

The read-only browser audit also checked the empty editor at 1440 × 1000 and the Box task panel
at 1024 × 768. Its lower fields remained reachable by focus-driven scrolling while Create/Cancel
stayed in the header. A 99-character selected feature name fit the status bar at 1024 px without
horizontal overflow, but exposed the separate model-tree defect below. At 512 px, the model toolbar's horizontal scrolling made the trailing commands
reachable; this is intentional overflow, not a confirmed clipping defect. Extremely narrow 256 px
CSS layouts fall outside the authoring envelope and are not counted as a supported-width regression.

## Confirmed defects and corrections

| Finding | Evidence | Correction |
| --- | --- | --- |
| Project units dialog extends above a short viewport | At 512 × 384 CSS pixels, the original dialog's top was −33 px | Shared dialogs now cap their height against the small viewport height and scroll internally |
| Long command results need a bounded scroll region | A compact palette must retain its search field while navigating to the last enabled command | The command root/list can shrink and the search field does not shrink |
| Save status invalidates unchanged mesh presentation | The regression fails on the baseline: `saving`, `saved`, and `error` publications call `setMeshes` again with the same report | Memoization follows feature and rebuild inputs rather than the entire controller; replacement geometry still updates |
| Renaming a feature hides the tree hierarchy | A 99-character name expands a 239 px tree to 842 px and focus restoration scrolls it right by 603 px | An explicit `minmax(0, 1fr)` grid column constrains rows so their existing truncation works without moving the hierarchy |

The alert-dialog primitive uses the same bounded-height rule. The browser regression opens an
inactive copied project's destructive confirmation and cancels it; it does not delete user data.

The performance correction avoids an unnecessary renderer disposal/recreation path. It is not a
measured frame-rate or overall speedup claim. Pointer raycasting and thumbnail generation remain
measurement candidates, not confirmed bottlenecks in this audit.

A parallel browser run additionally encountered a WebKit multisample allocation failure followed by
context loss, and Firefox document-startup assertion timeouts. These do not establish a memory leak.
The renderer caps device-pixel ratio at two and always requests antialiasing, but has no backing-buffer
pixel budget. Three.js handles its own context restoration; the application does not yet publish a
post-initialization context-loss state or explicitly request an on-demand repaint after restoration.
Explicit renderer/scene disposal already exists. Reproduce these resource conditions independently
before attributing them to canvas size, multisampling, concurrent browser load, or retained resources.

## Regression coverage

- `tests/e2e/ux-layout.spec.ts`: 512 × 384 effective CSS viewport, light/dark themes, project units,
  Escape/focus restoration, command-palette keyboard navigation, project library and destructive
  cancellation. The reduced viewport represents zoom-equivalent layout pressure, not native browser
  zoom or a promise of full authoring support at that width. A separate 1024 × 768 regression checks
  long-name rename/focus restoration and subsequent body selection without horizontal tree overflow.
- `apps/web/src/shell/geometry-viewport.test.tsx`: unchanged-report save publications do not replace
  meshes; a changed report does. Existing visibility/contextual-preview tests remain required.
- The [CAD workflow baseline](../testing-strategy.md#cad-workflow-baseline-gate) exercises the
  surrounding sketch, profile, Extrude/Revolve, preview, save and compact-layout lifecycle.

## Follow-up priorities

1. Finish recovery UX: offer explicit import-as-new for same-ID backups through complete-history
   copying, with no implicit overwrite.
2. Make print orientation graphical and inspectable before broadening fin coverage. Current support
   output still requires slicer and physical-print validation.
3. Audit toolbar keyboard traversal separately from command-palette access; horizontal overflow
   alone is not proof that a command is unreachable.
4. Add a reviewed backing-buffer budget and explicit context-loss/restoration feedback and repaint.
   Test DPR/resize limits, preserved camera/document state, restored rendering and recovery without
   hiding real renderer errors. Include a controlled low-memory/context-loss browser fixture.
5. Profile dense pointer picking and large-model thumbnails on a reproducible model/device before
   changing scheduling or geometry ownership.
6. Extend exact sketch curves and references only with solver, identity, persistence and profile
   contracts; a toolbar icon or a sampled visual curve is not a completed CAD capability.
