# Direct Manipulation and Shortcut Audit

Date: 2026-09-23

## Scope and ownership

The model tree's former earlier/later arrows are replaced by History drag grips. History already has
a revisioned move command, stable item/anchor references, dependency validation, undo, and replay.
The UI adds an input method; it does not introduce another document order. A position menu remains
available for users who cannot or do not want to drag.

Projects accepts one dropped `.vshape` file in its file card. Selection and dropping share local
import, validation, error feedback, and activation. Files are not uploaded and existing projects are
not overwritten. An in-flight import locks repeated activation and releases on failure.

Shortcut dispatch, toolbar labels, command-palette labels, and searchable F1 help share the existing
command descriptors. New modeling and sketch-reference bindings call existing handlers; they do not
bypass eligibility or create parallel implementations. See the current [keymap](ux-flows.md#alpha-keyboard-shortcuts).

## Dependency decisions

| Concern | Choice | Reason and boundary |
|---|---|---|
| History sorting | `@dnd-kit/react` + `@dnd-kit/dom` 0.5.0 | React 19 peer compatibility, pointer/touch and keyboard sensors, dedicated handles. The modern packages avoid a new legacy core/sortable integration. |
| Key matching | `@tanstack/hotkeys` 0.9.0 | Reuse parsing and exact modifier matching without adding a second registry, React store, or global manager. Application guards and eligibility stay local. |
| Native file drop | `react-dropzone` 20.1.2 | Handles external OS file dragging and a picker. A sortable list sensor is not a native-file import adapter. |

All are pinned in the Bun catalog and owned by `apps/web`. Their declared licenses are MIT; locked
transitive licenses must be included in release notices. These adapters do not change geometry,
document storage, or the application's Zustand state authority.

Atlassian Pragmatic Drag and Drop was considered; its accessibility guidance calls for separate
non-drag alternatives. dnd-kit fits the requested pointer-plus-keyboard list interaction directly;
VibeShape still provides a click/tap alternative. `react-hotkeys-hook` was considered, but installing
another hook-based registration layer is unnecessary when the editor already owns dispatch.

Official references: [dnd-kit quickstart](https://dndkit.com/react/quickstart/),
[sensors](https://dndkit.com/react/guides/sensors/),
[TanStack Hotkeys](https://tanstack.com/hotkeys/latest),
[Pragmatic accessibility](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines),
[react-dropzone](https://github.com/react-dropzone/react-dropzone).

## Other surfaces and remaining gaps

- Bodies are derived results, not independently reorderable feature history.
- Variables and the project library have no user-authored ordering command. Do not add visual-only
  sorting that suggests a persisted semantic change. A future product requirement must first define
  whether order is a local preference or document intent.
- Sketch points, dimensions, extrusion depth, revolve angle, and primitive placement already have
  geometry-owned drag interactions. Retain those owners; list sensors must not intercept the canvas.
- Global Fit, backup/export, standard-view keys, and user-remappable bindings are not yet delivered.
  Their named controls remain available; documentation no longer presents planned keys as working.
- Global Enter-to-Apply is intentionally absent: it must not commit a command while an input, picker,
  preview, or unrelated dialog owns Enter.

## Regression requirements

Verify pointer and keyboard History moves, forbidden dependencies, cancellation, stale revisions,
pending locks, click/tap alternative, undo/redo, reload, and unchanged geometry. Verify file picker
and drop share bounded single-file import with invalid-file and retry coverage. Verify IME, repeat,
text input, modal Escape, duplicate bindings, focused help, and current registry labels. Real browser
checks cover Chromium, Firefox, and WebKit; layout checks include compact width and both themes.
