# UI component contracts

## Purpose

This document defines the implementation contract for reusable controls in `@vibeshape/ui`. Product behavior remains governed by the [Design and UX Guidelines](../product/design-and-ux-guidelines.md); this document owns component layering, asynchronous action behavior, form integration, and the minimum states that each primitive must expose.

## Layering rule

`FieldLabel` composes optional `description` and `descriptionId` through `FieldHelp`, placing its
information button beside the native label. Text, native-select, searchable-select, and choice
fields use this disclosure for optional guidance and keep stable `aria-describedby` targets.
`FieldDescription` remains available for required visible instructions. `FieldHelp` also serves
section headings without importing form state; labels and help controls remain separate targets.
`Field` defaults to a horizontal 2:3 label/control grid; use its explicit vertical orientation for
full-width compound content. Empty error slots are omitted by standard field compositions.
Keep every horizontal field at the same available row width, including across section dividers.
Choice fields use wrapping label/control rows instead of the fixed split when space is limited.
Choice cards size from their content and move to another row before wrapping long labels within a
full-width card. The selected border and background replace the visible radio dot; the native radio
remains available to keyboard navigation, validation, assistive technology, and form submission.
Forced-colors mode uses an inset solid outline for selection and an outer dashed outline for keyboard
focus. Callers requiring a single-column choice field override both its display and grid columns.
Compose inline controls within its control cell. `NativeSelectField.trailingAction` places an
adjacent action in that cell without changing the label/control split; its caller owns the action's
accessible name, tooltip, and disabled state independently of the select.
Help triggers have distinct contextual names, such as “Help for Width”, while the popover is named
by its subject. `FieldHelpProvider` binds this shared `ui` catalog copy to the application locale;
isolated shared controls use the same English source catalog. This avoids adding a second control
with the input's exact accessible label. The help trigger uses a focusable button role with Enter and
Space activation so native disabled fieldsets lock editing while keeping guidance available.
`DialogContent` honors an enabled shared input's declared `autoFocus` before ordinary focusable
help controls, while preserving caller cancellation and the default fallback when none is available.
`TaskPanelHeader.description` is optional help. Required next actions and persistent description
targets use its `instruction` prop, which stays visible and mounted independently of any popover.

Build reusable controls in this order:

1. **Native primitive** — preserve the platform element, standard attributes, ref, focus, keyboard behavior, and accessible name.
2. **State-agnostic composition** — add labels, descriptions, validation, units, tokens, and variants without importing a form or application-state library.
3. **Integration adapter** — bind the composition to TanStack Form or another accepted state owner through a separate export.
4. **Feature composition** — connect commands, mutations, diagnostics, and domain view models in `apps/web`.

Base form controls are uncontrolled by default through native attributes such as `defaultValue` and `defaultChecked`. They MAY also accept controlled native props so an adapter can bind them, but they MUST NOT own a second copy of the value or import TanStack Form. The dependency direction is always `integration -> base component`.

VibeShape's TanStack Form adapter is exported from `@vibeshape/ui/integrations/tanstack-form`. Its `validationMessage` export is the shared validation-error formatter for separate feature-owned adapters, including CAD reference fields. Feature code uses the adapter for form state while remaining free to use base components for isolated native forms, search fields, file inputs, and progressive enhancement.

Product forms use registered `form.AppField` components rather than passing handwritten field-API
shapes through visual controls. The shared registration includes text, textarea, checkbox, native
select, Radix select, and string-valued choice fields. `formHookOptions` and `createFormHook` let an
application extend this registration while reusing the same contexts and shared form components;
CAD expression and geometry-reference adapters belong to `apps/web`, not `packages/ui`.

Reusable typed sections, including library metadata and assembly poses, use `withFieldGroup` with
explicit field-path mappings at their call sites. Keep the section independent of its parent form
and preserve its inferred value types.

Validation belongs to TanStack validators. Existing domain parsers return
`{ form: summary, fields: issues }`; `form.FormError` renders the summary and `useFieldError`
supplies field errors after blur or a submission attempt. Coupled CAD fields use the native
`revalidateLogic()` strategy with `validators.onDynamic`: validate on submission first, then
revalidate the complete form on changes so a corrected value clears errors on related fields.
Do not mirror field issues in React state or add a second validation scheduler. Command failures, stale revisions, connection status, and preview diagnostics
remain with their owning application workflow.

`Form` provides context, prevents repeated native submissions throughout asynchronous validation and
submission, and focuses the first enabled invalid control once per failed attempt. Native forms and
programmatic task navigation share `submitForm(form)`, which joins an existing submission until it
settles instead of starting another mutation. Submission owners use the shared `useIsMounted` hook
to reject work whose task was dismissed during validation. It defaults to
`noValidate` so TanStack owns validation and its accessible feedback. A workflow with native numeric
edit buffers may explicitly set `noValidate={false}` and must also check native validity before
programmatic submission. `SubmitButton` derives dirty, validity, and pending state from the store;
use `requireDirty={false}` for actions that are valid without edits. External operation state may
still disable conflicting controls.

Form integration follows one discoverable form-kit layout: shared contexts at the integration root, field adapters under `fields/`, form-owned controls under `components/`, and a single public `index.ts`. Reusable visual structure belongs to base `Field` primitives rather than being repeated in each adapter.

## Asynchronous action controls

An action control that observes a Promise-like handler result follows a single-flight contract:

- suppress the second pointer activation in a native double-click before invoking the handler;
- lock synchronously once a Promise-like result is returned so another event cannot enter before React renders;
- expose the pending state through `disabled`, `aria-busy`, and `data-loading`;
- preserve the action's accessible name while pending;
- release the lock after fulfillment or rejection;
- accept an external `isLoading` state for form submissions, mutations, and command dispatchers that do not return their Promise from `onClick`;
- preserve `aria-disabled` behavior and block activation when using `asChild` with a non-button element;
- leave error presentation to the owning command or form; a spinner is not an error boundary or diagnostic surface.

The application mounts one `ActivityProvider`. Pending Buttons and standalone Spinners register owned work with that scope; the application wordmark renders a high-contrast shimmer and a visible spinning icon in a reserved slot for background work. Concurrent owners keep it active until every owner settles or unmounts. `useReportActivity` connects work that has no Button or Spinner. The application bar also names the active project's assistant work with a reserved-width status and a reduced-motion-aware icon, driven by that project's existing chat controller even when chat is closed. An idle connection is not work. Other controls retain their action locks and accessible pending state; they do not insert spinners or change width. Isolated primitives outside the provider retain their inline-spinner fallback.

`useReportBlockingActivity` registers a localized label in the same activity scope. Blocking owners register and release tokens in layout effects before paint; ordinary background owners retain passive effects. One application-owned `BlockingLoader` renders the first active blocking label above a dimmed modal overlay; overlapping owners retain the block until all settle. It uses Radix focus containment, suppresses dismissal and background keyboard actions, and restores focus to the initiating element when it still exists. A blocking loader renders its own visible icon, independently of Spinner centralization. Browser Back/Forward navigation publishes its pending lifetime independently of the active document, including queued destinations and cancellation. Background document/window capture handlers suspend their shortcuts while the activity scope is blocking. Native application and editor command bridges publish empty command sets before paint and reject incoming or queued invocations during blocking, including text undo/redo. Visible model and assembly viewports cancel already-captured gestures through their viewer-owned cancellation port in a layout effect before the overlay paints. Sketch interaction owners separately cancel annotation, point, trim, transform, and pan sessions, including pointer captures and queued work, without recording a cancelled gesture. Ordinary Button promises remain non-blocking unless their operation owner explicitly registers blocking work.

The component detects the returned value instead of inspecting `Function.prototype.constructor`. Transpilation, wrappers, and ordinary functions that return a Promise make function-name checks unreliable.

The guard prevents accidental duplicate activation; it does not make a non-idempotent domain operation safe. Commands, persistence operations, imports, exports, and external side effects still require application-level eligibility, transaction, and idempotency rules.

## Viewport-bounded overlays

Shared `Dialog` and `AlertDialog` content must stay within the small viewport height with an outer gutter. Long content scrolls inside the overlay; its actions remain reachable by keyboard and scrolling. Feature-specific size overrides must preserve this contract. Command palettes keep their search field visible and shrink the scrollable results region instead of pushing content outside the dialog. Test compact effective viewport sizes in both themes, including Escape, focus restoration, and destructive-action cancellation.

The export dialog keeps its heading and action footer outside the scrolling settings body. Destination
and format, then scope and quality, form compact responsive groups; application choice and print
preparation remain secondary actions. Empty field-error slots do not reserve blank rows. Export and
handoff success use neutral fixed notifications with `role=status`; operational errors retain the
destructive `role=alert` tone. Neither notification changes the editor or dialog layout.

## Form adapter contract

TanStack Form integration uses `createFormHookContexts` and `createFormHook` once for the shared UI package.

- Field adapters read value and metadata from field context and pass native `value`, `name`, `onChange`, and `onBlur` props to the base component.
- Base components own visual structure, labels, descriptions, IDs, `aria-describedby`, `aria-invalid`, and stable error layout.
- Validation adapters normalize only supported error shapes. Unknown validation values do not become fabricated user messages.
- Submit controls subscribe only to the state they render: `canSubmit`, dirty state when required, and `isSubmitting`.
- Async submission sets the shared Button's external loading state and disables repeat submission.
- A form decides whether pristine valid values may be submitted. `SubmitButton` defaults to requiring a dirty form and exposes an explicit override.
- Field errors use `FieldError` beside their owning input, with `aria-invalid` and `aria-describedby`; they do not become toasts. Whole-form and contextual operation errors use the shared `Alert` icon, border, spacing, and typography. Operational notifications use the shared dismissible toast.
- Form errors remain attached to fields or a persistent form summary; rejected submission must not be represented only by a spinner or toast.

## Component requirement matrix

These requirements apply when each component is introduced or materially changed.

| Component family | Base contract | Integration and async checks |
|---|---|---|
| Button and command action | Native button semantics, explicit variants, accessible name, focus, disabled state, double-click guard | Single-flight Promise handling, external loading, preserved label, command-level error and idempotency |
| Text input and textarea | Uncontrolled by default, visible label, description, stable error line, ref, autocomplete, read-only versus disabled | Preserve raw edit text, bind on blur/change in the adapter, debounce preview outside the primitive |
| Numeric and unit input | Text editing semantics, tabular numerals, no wheel mutation while focused, unit and range copy | Parse on commit, distinguish incomplete/non-finite/dimensional errors, preserve the last valid committed value |
| Checkbox, radio, and switch | Native or Radix semantics, label click target, checked/defaultChecked support, indeterminate state where applicable | Adapter maps boolean or enum values; failed remote effects do not silently invert the visible value |
| Select and combobox | Keyboard navigation, typeahead, label, empty and disabled options, clear behavior | Async options expose named loading/error/empty states; stale responses cannot replace newer results |
| Slider and scrubber | Keyboard increments, min/max/step, numeric alternative, visible current value | High-frequency preview is separate from committed change; cancellation restores the committed value |
| Menu and command item | Underlying Radix/APG keyboard behavior, label and shortcut, disabled reason | Async work is dispatched to a persistent owner; closing the menu must not hide progress or failure |
| Dialog, sheet, and alert dialog | Title, description, focus containment/restoration, Escape behavior, safe default | Pending primary action disables conflicting controls; failure keeps the layer open with actionable copy |
| File input and import control | Native file selection, accepted format copy, size/limit copy, repeat selection reset | Reading/parsing stages, cancellation, stale selection, security limits, and persistent result diagnostics |
| Progress and status | Determinate values only when meaningful; named indeterminate state otherwise | Polite live updates, coalesced preview announcements, explicit canceled versus cancel-requested states |

Application-menu groups compose `DropdownMenuSections` with one direct child per visible section.
Conditional `null`, `undefined`, and boolean children are omitted before separators are inserted;
sections own their content and labels, never their own leading or trailing divider. `SelectField`
accepts an optional menu label and description for compact triggers whose selected value alone does
not identify the setting. These headings do not become selectable options.

## Verification contract

Shared interactive components require behavior tests, not snapshots alone.

Icon-only menu and command-picker buttons use the shared Button `dropdown` variant to show a
decorative lower-right chevron without changing the control size or accessible name. Labeled
triggers and split-menu buttons retain their existing inline chevron.

- Test native uncontrolled behavior before testing any form adapter.
- Test pointer double-click, keyboard activation where custom handling exists, disabled behavior, and focus preservation.
- Test async fulfillment and rejection, immediate repeat attempts, external loading, and unmount or cancellation behavior when relevant.
- Test label and description relationships, validation announcements, and accessible names while pending.
- Test the TanStack adapter separately for value binding, validation timing, dirty policy, and single submission.
- Run UI typecheck, focused Bun tests, production Vite build when styles or exports change, Playwright E2E for user-visible flows, and Fallow changed-code audit.

## Implemented foundation

The foundation includes:

- `Button` with double-click suppression, Promise-like single-flight loading, native or slotted disabled semantics, and external `isLoading` support;
- `Spinner` with standalone status semantics and decorative use inside named controls;
- source-owned `Dialog` and `AlertDialog` compositions; destructive product flows use a controlled AlertDialog that can remain open across asynchronous failure;
- a source-owned portaled `Popover` composition and an application-level, state-agnostic variable-expression combobox that preserves native input value ownership, caret position, and accessible listbox semantics;
- native `Input` plus native `NativeSelect`, with state-agnostic `TextField` and `NativeSelectField` compositions that own labels, descriptions, and stable validation relationships;
- shared `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` compositions for consistent form layout;
- a TanStack Form integration exposing typed registered fields, shared validation feedback and focus, composable hook registrations, and a single-flight submit control;
- state-agnostic primitive and sketch-dimension fields with separate TanStack Form adapters that preserve raw Quantity expressions, share variable completion through explicit value callbacks, publish transient draft state outside base controls, and submit through the shared single-flight action contract;
- a specialized SVG sketch canvas that receives one schema-valid analytical draft, delegates mutations, click-targeted analytical curve modification, and deterministic point, bounded-intersection, direction inference, and regular-polygon construction to pure domain operations, preserves retained curve identity while repairing detached endpoint dependencies, represents a split circle as complementary equal-radius arcs without redundant SolveSpace equations, persists accepted inference and polygon design intent as ordinary constraints, coalesces drag samples to one inference/render update per animation frame, exposes entity and stable-region selection, renders constraint and authored-dimension glyphs, and keeps solved display geometry disposable;
- Bun and Testing Library coverage for the base and integrated layers.
