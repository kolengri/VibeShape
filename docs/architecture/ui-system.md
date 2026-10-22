# UI system: Tailwind CSS and shadcn/ui

This document owns the UI implementation architecture, package boundaries, and token system. [Design and UX Guidelines](../product/design-and-ux-guidelines.md) is the product-level contract for layout, interaction, accessibility, content, and acceptance behavior. Components MUST satisfy both documents.

## Decision

Use **Tailwind CSS v4** and **shadcn/ui CLI v4 with Radix base** as the interface foundation. Shared primitives and design tokens live in the `@vibeshape/ui` workspace; CAD-specific components are composed in `apps/web`. Form primitives are state-agnostic and uncontrolled by default, while typed product forms use the separate TanStack Form adapter accepted in [ADR-0010](../adr/0010-uncontrolled-form-primitives-and-tanstack-form.md).

shadcn/ui is not an opaque component dependency. Its CLI copies component source into the repository. We own and review that source, can add compact variants, and maintain it as application code.

## Package boundaries

```text
apps/web/
  src/
    features/
      model-tree/
      sketcher/
      feature-editor/
      print-check/
    shell/
    routes/
  components.json

packages/ui/
  src/
    components/          # shadcn/Radix primitives and state-agnostic field compositions
    hooks/               # purely visual/shared hooks
    integrations/
      tanstack-form/     # contexts, registered fields, form components, and public entry point
    lib/cn.ts
    styles/globals.css   # Tailwind import + semantic tokens
  components.json
  package.json           # explicit exports
```

`@vibeshape/ui` MAY import React, Radix, class-variance-authority, Tailwind utilities, and TanStack Form inside its explicit integration entry point. Base components MUST NOT import TanStack Form. The package MUST NOT import domain, geometry worker, persistence, or application-state packages.

`apps/web` owns product-copy catalogs and composes the `@vibeshape/i18n` provider accepted in [ADR-0011](../adr/0011-use-intl-localization-layer.md). Shared primitives remain copy-free when possible; component-owned copy uses a distinct shared catalog namespace rather than hard-coded display strings.

`apps/web` owns:

- `ModelTree`, `FeatureEditor`, and `SketchConstraintList`;
- binding UI behavior to commands and view models;
- viewport overlays and selection behavior;
- product-specific shortcuts and diagnostics;
- composition of primitives into work panels.

## Editor-session state

`apps/web/src/editor-session` owns one vanilla Zustand store instance per active editor session. React
provides that instance through context and consumes narrow selectors; Immer middleware implements
cohesive nested updates without exposing mutable state to components. The provider creates its store
once per mount through lazy React state. It does not inspect document identity, mutate refs during
render, or replace the context value in response to a prop change. The owning application keys the
provider by the visible document ID, so an in-place project switch remounts transient editor state.
Document workers, project assistants and pending reviews have separate retained project owners;
switching the visible provider does not dispose those resources. Concurrently mounted editors must
each own a separate provider or use an explicitly keyed store registry.

The store owns workspace and active-tool coordination, viewport selection, origin-plane, saved-sketch, and feature visibility,
unsaved sketch drafts, sketch-local undo and redo, profile selection, and transient shell overlays. It MUST NOT own or clone
the committed document snapshot, semantic revision history, TanStack Form values, persisted records,
worker sessions, solved geometry, mesh buffers, or Three.js objects. Store actions may prepare UI
intent, but committed changes still pass through the ordinary revision-checked application command
and persistence path. Third-party extensions and MCP adapters never receive the store instance.

Persistent UI preferences use their existing schema-validated preference owners rather than the
editor-session store. Zustand persistence middleware is not enabled for semantic or draft state.

Committed viewport mesh presentation follows the feature snapshot and rebuild response identities,
not the entire document-controller state. A save-status-only publication must not replace unchanged
viewer meshes or recreate GPU geometry. Visibility, contextual hiding, and actual rebuild changes
still invalidate the presentation; transient previews keep their separate ownership.

Feature-save completion is scoped to the initiating tool generation. A late save may finish its
ordinary document transaction but cannot close a newer sketch edit or a reopened feature task.
History navigation requested during a manual feature save waits for that submission to finish
without starting another save. Only the latest requested destination opens after the task closes;
validation or persistence failure retains the current editor.
Disposable feature-preview workers exist only while a preview-capable feature tool is active.
Debounce invalidation clears the visible candidate without restarting the worker; leaving the tool
releases it, and stale completion or rejection cannot update a newer preview.

## shadcn CLI routing in the monorepo

Every workspace that can receive CLI-generated files has a consistent `components.json`.

- `packages/ui/components.json`: package-local aliases target `#components`, `#lib`, and `#hooks`.
- `apps/web/components.json`: `ui` and shared utilities target `@vibeshape/ui/...`; application components use local aliases.
- `@vibeshape/ui/package.json` exports `./components/*`, `./lib/*`, `./hooks/*`, and `./globals.css`.
- The application depends on `@vibeshape/ui` through `workspace:*`.
- `style`, `baseColor`, `iconLibrary`, and base implementation match across both configs.
- The Tailwind v4 config path is empty.

Bootstrap is non-interactive and reviewable. The conceptual command for a new Vite monorepo is `bunx --bun shadcn@latest init -t vite --monorepo -d --base radix`, but generated structure is never accepted blindly and Turborepo is optional. For an existing scaffold, init uses defaults or a reviewed preset with Radix base, followed by a diff review of `components.json`, CSS, and package manifests. `-y` alone is not sufficient for guaranteed non-interactive execution; use `-d`.

Add primitives from `apps/web` or with an explicit working directory. Run `--dry-run` or inspect `--diff` before accepting changes. `add --all` is prohibited.

## Tailwind v4

- Use the official `@tailwindcss/vite` plugin.
- Use `@import "tailwindcss"` in shared global CSS.
- Define the theme primarily through CSS custom properties and `@theme inline`.
- Never generate runtime class fragments such as ``bg-${color}-500``.
- Express repeated variants with `cva` and merge classes through `cn()` using `clsx` and `tailwind-merge`.
- Group long static utility sets by interaction concern instead of storing an entire component style in one opaque line.
- Use arbitrary values only for genuinely computed layout or overlay geometry.
- Viewport model geometry is not styled with Tailwind classes.

## CAD visual direction

VibeShape is a dense tool, not a marketing dashboard:

- dark-first with a complete light theme;
- `new-york` as the initial shadcn density/style with Radix base;
- neutral or zinc surfaces with one restrained primary accent;
- compact dimensions: 32–36 px command rows, 28–32 px panel controls, 12–14 px body text; a horizontally scrolling sketch toolbar reserves a separate native scrollbar lane below its controls;
- smaller radius than consumer cards, while following one radius scale;
- panels separated by borders and resizable separators, not nested cards;
- no gradients or glassmorphism in the working area;
- source-owned colored icons with shared optical sizing and palette; see [the icon contract](../product/icon-design.md);
- the viewport remains visually dominant.

## Browser and feature timeline

The Model workspace composes two presentations of the same document command callbacks: an object browser on the left and a chronological timeline below the resizable workspace. The timeline owns compact/Details disclosure and horizontal keyboard navigation; existing History rows retain graph validation, drag revisions, folder selection, deletion, suppression, source previews, and insertion guards. Object selection and timeline editing remain distinct actions.

A transient reveal request connects a terminal feature result to its browser row, expands the browser and object group, and restores focus there. It never changes geometry or becomes saved document data. Origin plane controls and object-folder actions remain application commands and view preferences. Sidebar backgrounds default to 94% opacity without overriding saved preferences. The orientation inset labels its actual camera-aligned positive axis endpoints and distinguishes negative endpoints; it reuses the existing render schedule and owns/disposes its glyph resources.

The viewport and active task stay mounted when History collapses or Details changes. Toolbar grouping composes the resolved editor commands rather than installing another registry or eligibility path.

The History transport resolves positions against the complete interleaved order and reuses guarded
History insertion actions. Its draggable vertical divider commits on release and shares one navigation lock with the
transport buttons. The divider derives positions from visible row/folder bounds, supports keyboard
navigation, and cancels transient gestures on Escape, lost capture or document/revision changes. The transient cursor filters visible geometry and inputs, never the saved authority.
Per-row folder grouping descriptions supplement edit selection without adding checkbox controls.

The Assembly browser owns local filtering/disclosure and delegates all selection, edit and motion
commands. Motion sessions solve disposable frozen-source previews sequentially, abort their worker on
cancellation, keep the camera stable, and commit one guarded joint update only on Apply. Project/revision
identity invalidates a session. Export and interference retain the saved assembly as authority.

The Plugins dialog composes a feature-owned local package manager through a translated shell adapter.
Strict declarative packages remain data; only a bundled first-party iframe renderer executes. See
[Extension architecture](extensions.md) for capabilities and isolation.

## Semantic tokens

Extend the base shadcn tokens with CAD-specific tokens:

- `--background`, `--foreground`, `--card`, `--popover`, `--border`, `--input`, and `--ring`;
- `--panel`, `--panel-muted`, `--toolbar`, and `--viewport-background`;
- `--selection`, `--preselection`, and `--selection-foreground`;
- `--sketch-reference-context` for visible-but-uncommitted earlier-sketch projection;
- `--sketch-under`, `--sketch-full`, `--sketch-conflict`, and `--construction`;
- `--feature-active`, `--feature-suppressed`, `--feature-error`, and `--feature-stale`;
- `--diagnostic-info`, `--diagnostic-warning`, and `--diagnostic-error`;
- `--axis-x`, `--axis-y`, and `--axis-z`;
- compact spacing, control-height, panel-width, and radius tokens.

Never encode state with color alone. Add icons, shape, text, or line style. Check contrast in both themes and in viewport overlays.

## Initial primitive set

Add components only when needed, in this order:

1. `button`, `tooltip`, `separator`, `scroll-area`;
2. `input`, `label`, `select`, `checkbox`, `slider`;
3. `dropdown-menu`, `context-menu`, `popover`;
4. `dialog`, `alert-dialog`, `sheet`;
5. `command` for the command palette;
6. `tabs`, `resizable`, `collapsible`, `badge`, `progress`, `skeleton`;
7. `table` for tabular data only, never as the model tree.

The model tree is a dedicated accessible and virtualized tree because generic shadcn components do not define CAD tree selection or keyboard semantics.

## Composition rules

The app root owns one scoped activity provider and one notification provider. Shared pending controls report activity without sharing command authority, cancellation, or persistence. The wordmark observes the aggregate while action owners retain their locks. Fixed notifications use the existing Radix Toast viewport branch so dismissing an error does not dismiss an active dialog. Registrations follow their source lifetime; repeated explicit attempts can resurface a dismissed error.

- Follow the complete [UI component contracts](ui-component-contracts.md) for component layering, asynchronous actions, form adapters, state inventories, and verification.
- Follow [Internationalization](internationalization.md) for all product copy, accessible names, validation, status, and diagnostic messages.
- Build the native or state-agnostic primitive before its TanStack Form adapter; the adapter imports the primitive, never the reverse.
- Buttons that start Promise-like work become single-flight, expose an accessible pending state, and suppress accidental double activation. Error reporting remains owned by the command or form.
- Task panels compose the shared compact lifecycle action group in their non-scrolling command header. The group owns only Cancel and Accept presentation; the task owns persistence, diagnostics, and disabled eligibility. Modeling commands remain registered shell commands rather than task-panel footer buttons.
- Use `AlertDialog`, not `Dialog`, for destructive confirmation.
- Provide one tooltip provider at the application root.
- Toolbar actions use button variants without losing native focus and keyboard behavior.
- Invalid inputs have labels, messages, and `aria-invalid`, not only a red border.
- The command palette invokes the same application commands as toolbars, menus, and shortcuts.
- The cursor-near sketch shortcut toolbar is a non-modal `Popover` + ARIA `Toolbar` projection of the same resolved command registry. It stores only transient anchor and focus-return state; it never owns document intent, command eligibility, or handlers.
- Command presentation uses source-owned shadcn composition over `cmdk`. Serializable descriptors contain stable identity, owner, localization keys, grouping, icon identity, toolbar placement, and shortcut metadata; trusted handlers contain eligibility and invocation. Composition fails closed before the shell renders.
- Disabled commands remain searchable with localized reasons. Successful palette invocations may affect bounded local ranking, but project data, command eligibility, and document history never depend on that preference.
- `Ctrl/Cmd+K` is reserved from text entry. Tool shortcuts ignore input, textarea, select, editable, textbox, repeat, and IME events; `Escape` remains eligible for the documented CAD cancellation hierarchy.
- Context menus are never the only way to invoke an action.
- Layout state such as panel sizes and theme is a local UI preference, not domain state.
- Add a visual harness or Storybook only if it pays for itself; command-flow E2E remains mandatory.

The compact task sheet uses at most half of the available workspace height, with its contents
scrolling inside that sheet. Header and History height are excluded from this budget so the drawing
area remains usable on short windows.

## Direct manipulation and keyboard adapters

Axial gizmos retain the positive Extrude minimum by default. A tool may explicitly supply finite
distance bounds; Split uses its signed form bounds so dragging crosses zero without reversing the
plane normal. The renderer clamps the handle and publishes the same bounded field value.

History source links resolve canonical single- or multi-profile feature inputs, including hole identity,
into existing viewport preselection. The workspace owns the disposable preview; tool, workspace, project,
or semantic revision changes clear it. A successful exact rebuilt selector may temporarily reveal a
hidden sketch without changing session visibility, selected profiles, or document intent. Missing or
stale selectors reveal nothing. The renderer and saved-profile picker remain separate: inspection must
not open a new profile-selection control. No additional worker solve or geometry rebuild is requested.
Hovering a visible source, or another region within the same revealed sketch, preserves the rendered
sketch collection instead of recreating its meshes. A missing sketch is a noninteractive unavailable
source, not an unnamed locate action. A source-link activation invokes the existing source History row, preserving its draft guards and edit-point behavior. Untouched Extrude, Revolve and Placement editors retain their authored record and reuse successful committed geometry only at the matching document and revision; changed parameters or source references require a fresh disposable preview.

The sketch projection store is a transient bridge between the analytical SVG editor and the
Three.js viewport. Normal mode publishes sketch bounds to align the camera. Orbit editing publishes
the camera's normalized support-plane affine transform in the opposite direction; camera publications
must never trigger normal-mode camera alignment. SVG drawing and HTML annotation anchors use the
forward transform, and pointer positions use its inverse. The viewer rejects near-edge-on projection
before accepting drawing input. Orthographic zoom, pan, standard views, resize, and support changes
all invalidate the projection without mutating the draft or invoking the solver.

Cubic Bezier control points use diamond markers, while curve endpoints retain circular markers.
Each control has a thin dashed handle to its corresponding curve endpoint. The handles share the
analytical curve projection and update with the transient drag overlay; they do not accept pointer
input or add construction geometry, constraints, or document edits.
Saved sketch previews and camera navigation retain the same control roles and endpoint handles.
The web adapter derives their world coordinates from the current display's solved point identities;
the viewer owns disposable handle buffers and constant-screen-size circle/diamond point sprites.
Missing solved metadata does not fall back to unsolved authored coordinates. No worker or document
schema change is needed for this presentation.

Horizontal and vertical dimensions against a fixed construction origin retain their authored formula
labels and use stable screen-space offsets beside the measured point, with visible direct leaders.
By default, only the hovered or selected point's coordinate dimensions are shown; a sketch-local
Show all point dimensions toggle reveals the full set. Hover remains active while moving into its
labels, and selected constraints stay available to keyboard and task-panel editing. The preference
never changes the document or invokes the solver. A manually dragged annotation retains its
sketch-space position and leader. Ordinary point-pair dimensions retain their midpoint anchors.

OrbitControls temporarily binds to the active sketch SVG, with primary/touch input reserved for
editing and middle/secondary input reserved for navigation. Viewport controls colocate Rotate view, Section view, standard views, and Fit view; shell-owned
command projections use the existing registered handler. Section parameters remain viewport-local
and render in a non-modal popover. The registered Rotate view toggle uses the transient `navigate` camera mode: the analytical overlay
is inert, the current solved draft renders in the 3D viewer, and the canvas owns navigation without
sketch reference picking. Selecting a sketch tool returns to orbit editing. Cleanup restores the canvas binding.
Holding Space invokes the registered navigation command and enters transient `navigate-held` mode:
mouse movement over the drawing rotates the camera without pressing a mouse button. Native pointer
drags are suppressed during the hold, and movement over other UI regions does not rotate the camera.
Release returns to orbit editing in the resulting camera pose. Key repeat cannot toggle the mode, and blur, hidden-document
and shortcut-scope cleanup release the hold. Text inputs, native controls, dialogs and the command
palette retain Space ownership. An already enabled Rotate view toggle remains enabled after Space.
Primary pointer cancellation and release outside the canvas cannot leave navigation disabled.
Changes between SVG and canvas input bindings recreate OrbitControls with the current pose and target,
discarding any tracked pointers when a mode changes before pointer-up.
Blocking application activity calls the viewport-owned `cancelInteractions` boundary before the overlay paints. It cancels orientation, section, paint, translation, angular, and sketch-navigation gestures and recreates OrbitControls with the current camera pose and target to discard captured pointer state. Section and feature manipulator cancellation use their ordinary restoration paths. Sketch-owned annotation, point, trim, transform, and pan sessions separately release captures and discard queued frames and live-solve timers without committing a cancelled gesture. Point cancellation clears shared drag state even when a queued transition has not committed. It restores the last settled solve without a drag target only when its authored solve inputs still match; otherwise it restores current authored geometry with no continuation. A cancellation generation prevents late results from publishing geometry or seeding continuation. Ordinary pointer-up and PointerCancel settlement retain their existing behavior. The overlay then owns input containment; the next gesture starts from the retained view when blocking finishes.

Explicit camera-up changes recreate OrbitControls to refresh its cached orbit axis, preserving the
target, enabled state, input bindings, and current view before returning to modeling navigation.
Graphical Use, Pierce, and Intersection retain their separate 3D picking ownership. This bridge is
viewer/UI state only and introduces no document schema, worker protocol, or persistence changes.

History reorder uses `@dnd-kit/react` and `@dnd-kit/dom` for pointer and touch sensors,
collision feedback, and drag interaction. The application translates a drop into the existing
revisioned `org.vibeshape.history.move-item` command. Preview is disposable; neither the library's
optimistic order nor a DOM index becomes persisted identity. Incomplete dependencies, editing,
rollback, read-only state, and stale revisions remain blocked by the owning command boundary.

The whole History row is the pointer activation surface; nested action controls are excluded by the
sensor's interactive-element policy, while the treeitem label is explicitly eligible. Reordering has
no keyboard adapter or position menu. Arrow keys navigate the object tree; Left/Right navigate the horizontal History timeline. Enter activates an item, and F2
renames it. Each row exposes one actions menu for its semantic operations. See the
[interaction contract](../product/direct-manipulation-and-shortcuts.md) for thresholds and gestures.
The tree owns localized drag instructions and live announcements instead of the generic accessibility
plugin, whose disabled activator attributes would incorrectly disable the whole row's other actions.
The sortable wrapper is not a Tab stop.

The Projects dialog uses `react-dropzone` for native file dragging and file selection. Both routes
enter the same bounded `.vshape` import pipeline. Accepting a file extension is not format validation.

`@tanstack/hotkeys` owns key parsing/matching, while `EditorCommandDescriptor` remains the only
command binding registry. The existing dispatcher retains selection eligibility, modal/input/IME
guards, and single-command routing. It does not install a second global hotkey manager. The searchable
shortcut help reads descriptors, including mode requirements; local interaction gestures are listed
separately. See [the interaction audit](../product/direct-manipulation-and-shortcuts.md).

## Themes

- `dark`, `light`, and `system`;
- theme class on `<html>`;
- preference stored separately from the project;
- print and export colors independent of UI theme;
- high-contrast preset considered after the base accessibility audit;
- self-hosted or system-first fonts so offline use never requires a third-party network.

## Task panel lifecycle controls

The application-owned `TaskPanelHeader` places one lifecycle group at the command heading.
`TaskPanelLifecycleActions` and `TaskPanelLifecycleButton` share icon size, action order, labels,
tooltips, pending state, and disabled feedback. Feature parameter forms retain their TanStack
adapter; assembly tasks retain native form submission and supply their existing task title/error
through the assembly UI context. Neither composition changes document authority or saved data.
Retained-feature repair supplies its replacement-body controls through the header-content provider,
so the active feature form owns one command heading and keeps its native Save action inside the form.

The lifecycle group locks cancellation while its asynchronous accept callback is pending and
releases the lock on fulfillment or rejection. Forms also expose their own submission state.
Manual automation reviews retain their original decision controller and use the accept renderer
only to preserve a destructive confirmation trigger. Item deletion and navigation within a
subtask remain separate from panel cancellation. Generate and analysis cancellation are
computational actions, rather than additional Save/Close controls.

## Verification

- keyboard-only core flows;
- ARIA toolbar, menu, dialog, tree, and status-message behavior where applicable;
- focus trap and restoration for dialog, sheet, and popover;
- contrast and non-color state cues;
- minimum target size and spacing;
- 200% zoom at minimum desktop width;
- long localized labels;
- pointer and trackpad behavior, with touch later;
- screenshot tests for both themes;
- no missing Tailwind classes in the production build;
- controlled CSS size and shipped primitive count; remove unused generated components.

## Updating shadcn components

The CLI does not update components like an opaque dependency. For each update:

1. Record and pin the CLI version.
2. Use `view` or `--diff` for the target component.
3. Preserve project-specific CAD variants and accessibility fixes.
4. Verify unified `radix-ui` imports.
5. Run typecheck, visual/component tests, and E2E.
6. Update third-party notices when the source or dependency set changes.

Record the preset in the repository. Running `init --force` without review is prohibited because it may rewrite CSS tokens and component configuration.

## Assistant presentation and viewport capture

The project-keyed editor scope owns a small assistant presentation context. Only the toggle and
mounted panel consume its visibility; chat updates remain inside the project chat controller. Chat
occupies a separate shell grid column outside the editor. Opening it resizes the complete editor,
including the toolbar, canvas, History, and status bar, while preserving the mounted viewport and task
form. CSS safe insets keep viewport controls clear of the floating editor tools. The display
transcript mounts on the first explicit panel opening, so project navigation
does not parse Markdown or construct message DOM for a closed chat. Later closes retain that DOM,
its scroll state, the controller, and transient composer state.

A separate scope-local capture port registers the currently visible viewport. An explicit composer
action requests a fresh render and synchronous copy of its WebGL buffer before asynchronous PNG
encoding. The copy is bounded to 1,600 pixels on its largest dimension and never resizes the live
canvas. Unregistered or replaced viewports discard outstanding results. Provider capabilities and
the ordinary attachment admission pipeline remain authoritative.
