# SolidCraft UX adaptation

Reference: [SolidCraft v0.16.1, dded27277f78fa553879ea75de9c2c1ff183c777](https://github.com/tangency-labs/solidcraft/tree/dded27277f78fa553879ea75de9c2c1ff183c777), inspected 2026-10-18. License: MIT OR Apache-2.0. This implementation adapts interaction patterns using existing VibeShape components; it copies no SolidCraft source or artwork.

## Adapted

- Separate left object browser and bottom chronological timeline. The browser keeps parts/bodies and a distinct Sketches folder; the timeline owns feature order, folders, insertion and edit points.
- Compact operation icons with accessible names, selected/hover state, repair indicators and a visible edit boundary. Details exposes existing rich metadata and source-profile previews.
- Independent browser-folder and History disclosure; horizontal scrolling and keyboard navigation. The existing camera and active task remain mounted during layout changes.
- Find in browser for available terminal results, using existing part/body selection and a transient UI reveal request. No guessed result for consumed, suppressed, missing or rolled-back geometry.
- Named Create, Modify, Primitives and Inspect menus, keeping common sketch/extrusion/revolve actions direct. Commands retain eligibility, shortcuts, disabled reasons and invocation ownership.

Primary sources: [browser.rs](https://github.com/tangency-labs/solidcraft/blob/dded27277f78fa553879ea75de9c2c1ff183c777/crates/ui-egui/src/browser.rs), [timeline.rs](https://github.com/tangency-labs/solidcraft/blob/dded27277f78fa553879ea75de9c2c1ff183c777/crates/ui-egui/src/timeline.rs), [toolbar.rs](https://github.com/tangency-labs/solidcraft/blob/dded27277f78fa553879ea75de9c2c1ff183c777/crates/ui-egui/src/toolbar.rs).

## Existing VibeShape behavior retained

- Sticky task header and Finish sketch action, independent scrolling options.
- Command search with categories, shortcuts, disabled explanations and recent commands.
- Context-aware task selection, disposable previews, Escape cancellation hierarchy, revisioned edits and worker-owned geometry.
- Dependency-checked History dragging, suppression, semantic rename/delete, source-profile navigation and rollback guards.
- Resizable browser/task panels and compact task sheet/drawer behavior.

## Further ideas requiring a separate capability slice

- Select Other / all-hit picking for overlapping faces: requires candidate identity and viewer interaction work, beyond panel layout.
- Browser folder visibility independent of child eye preferences: requires a distinct UI state contract instead of overwriting child visibility.
- Search favorites and automatic selection-field advance: useful, but require preference ownership and per-command compatibility rules.

Source inspection establishes implemented behavior, not measured usability or performance improvement. Geometry, solver, worker protocols and document schemas are unchanged by this adaptation.

## Assembly and extensions comparison

VibeShape already implements component definitions/instances, grounding, static mates (including closed loops), exact interference, immutable local-library references, and native persistence. Existing implementation/tests include `tests/e2e/assembly-ui.spec.ts`, `tests/e2e/assembly-general-mates.spec.ts`, `packages/sketch-solver/src/assembly.test.ts`, and ADR-0069/0072/0080/0089. This comparison inspected tests; it did not rerun the assembly corpus.

SolidCraft additionally implements nested active components, Paste New, as-built joints/rigid groups, driven motion links/studies, contact sets, and exploded views. [Component commands](https://github.com/tangency-labs/solidcraft/blob/dded27277f78fa553879ea75de9c2c1ff183c777/crates/engine/src/cmd/component.rs) and [motion commands](https://github.com/tangency-labs/solidcraft/blob/dded27277f78fa553879ea75de9c2c1ff183c777/crates/engine/src/cmd/motion.rs) are implementation evidence. The practical next steps are Assembly discovery around existing actions, one driven-joint preview, then explicitly designed nested occurrence identity. Motion simulation is not supplied by changing the tree.

SolidCraft's [plugin document](https://github.com/tangency-labs/solidcraft/blob/dded27277f78fa553879ea75de9c2c1ff183c777/docs/plugins.md) describes a future Wasm/WIT host; no implemented plugin SDK was found in the inspected source. VibeShape has a tested private extension sandbox spike, but executable third-party support/public SDK remain disabled under ADR-0012/SPK-006. First prove one deterministic production extension with bounded capability, execution, persistence/undo and recovery before offering a marketplace. The follow-up slices below implement a bounded motion workflow and an initial data-only plugin profile; arbitrary executable support remains gated.

## Additional requested UX

Project-specific URLs select real local document IDs and preserve project-switch guards. Both sidebars default to subtle 94% opacity while retaining explicit saved preferences. The object browser gains a project heading, section icons/counts, contextual sketch creation and functional origin-plane controls. Orientation labels are attached to actual camera-aligned axis endpoints.

## Follow-up slices

The same task adds a directly draggable vertical History divider with keyboard transport, sharing the
existing save/validation guard and effective sketch-edit boundary. Navigation changes the visible
prefix without changing full saved authority. Shift-click and Shift+Space replace row checkboxes.

The Assembly browser gains grouped instances/joints/definitions, filtering and direct drive entry.
Existing solver APIs provide revolute, prismatic and cylindrical preview coordinates, bounded sweeps,
cancellation and one explicit Apply; export/interference retain saved authority. This is kinematics,
not dynamics, contact simulation or a nested occurrence system.

Local declarative UI plugins now install after capability review and expose isolated calculator panels.
Original-byte integrity, bounded stores, Web Locks, revocation and a trusted opaque-frame renderer
provide the initial workflow without package code or document access. See
[ADR-0109](../../docs/adr/0109-local-declarative-ui-plugins.md).
