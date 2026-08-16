# UI component contracts

## Purpose

This document defines the implementation contract for reusable controls in `@vibeshape/ui`. Product behavior remains governed by the [Design and UX Guidelines](../product/design-and-ux-guidelines.md); this document owns component layering, asynchronous action behavior, form integration, and the minimum states that each primitive must expose.

## Layering rule

Build reusable controls in this order:

1. **Native primitive** — preserve the platform element, standard attributes, ref, focus, keyboard behavior, and accessible name.
2. **State-agnostic composition** — add labels, descriptions, validation, units, tokens, and variants without importing a form or application-state library.
3. **Integration adapter** — bind the composition to TanStack Form or another accepted state owner through a separate export.
4. **Feature composition** — connect commands, mutations, diagnostics, and domain view models in `apps/web`.

Base form controls are uncontrolled by default through native attributes such as `defaultValue` and `defaultChecked`. They MAY also accept controlled native props so an adapter can bind them, but they MUST NOT own a second copy of the value or import TanStack Form. The dependency direction is always `integration -> base component`.

VibeShape's TanStack Form adapter is exported from `@vibeshape/ui/integrations/tanstack-form`. Feature code uses the adapter for form state while remaining free to use base components for isolated native forms, search fields, file inputs, and progressive enhancement.

Form integration follows one discoverable form-kit layout: shared contexts at the integration root, field adapters under `fields/`, form-owned controls under `components/`, and a single public `index.ts`. Reusable visual structure belongs to base `Field` primitives rather than being repeated in each adapter.

## Asynchronous action controls

An action control that observes a Promise-like handler result follows a single-flight contract:

- suppress the second pointer activation in a native double-click before invoking the handler;
- lock synchronously once a Promise-like result is returned so another event cannot enter before React renders;
- expose the pending state through `disabled`, `aria-busy`, `data-loading`, and a visible spinner;
- preserve the action's accessible name while the spinner is visible;
- release the lock after fulfillment or rejection;
- accept an external `isLoading` state for form submissions, mutations, and command dispatchers that do not return their Promise from `onClick`;
- preserve `aria-disabled` behavior and block activation when using `asChild` with a non-button element;
- leave error presentation to the owning command or form; a spinner is not an error boundary or diagnostic surface.

The component detects the returned value instead of inspecting `Function.prototype.constructor`. Transpilation, wrappers, and ordinary functions that return a Promise make function-name checks unreliable.

The guard prevents accidental duplicate activation; it does not make a non-idempotent domain operation safe. Commands, persistence operations, imports, exports, and external side effects still require application-level eligibility, transaction, and idempotency rules.

## Form adapter contract

TanStack Form integration uses `createFormHookContexts` and `createFormHook` once for the shared UI package.

- Field adapters read value and metadata from field context and pass native `value`, `name`, `onChange`, and `onBlur` props to the base component.
- Base components own visual structure, labels, descriptions, IDs, `aria-describedby`, `aria-invalid`, and stable error layout.
- Validation adapters normalize only supported error shapes. Unknown validation values do not become fabricated user messages.
- Submit controls subscribe only to the state they render: `canSubmit`, dirty state when required, and `isSubmitting`.
- Async submission sets the shared Button's external loading state and disables repeat submission.
- A form decides whether pristine valid values may be submitted. `SubmitButton` defaults to requiring a dirty form and exposes an explicit override.
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

## Verification contract

Shared interactive components require behavior tests, not snapshots alone.

- Test native uncontrolled behavior before testing any form adapter.
- Test pointer double-click, keyboard activation where custom handling exists, disabled behavior, and focus preservation.
- Test async fulfillment and rejection, immediate repeat attempts, external loading, and unmount or cancellation behavior when relevant.
- Test label and description relationships, validation announcements, and accessible names while pending.
- Test the TanStack adapter separately for value binding, validation timing, dirty policy, and single submission.
- Run UI typecheck, focused Vitest tests, production Vite build when styles or exports change, Playwright E2E for user-visible flows, and Fallow changed-code audit.

## Implemented foundation

The foundation includes:

- `Button` with double-click suppression, Promise-like single-flight loading, native or slotted disabled semantics, and external `isLoading` support;
- `Spinner` with standalone status semantics and decorative use inside named controls;
- source-owned `Dialog` and `AlertDialog` compositions; destructive product flows use a controlled AlertDialog that can remain open across asynchronous failure;
- a source-owned portaled `Popover` composition and an application-level, state-agnostic variable-expression combobox that preserves native input value ownership, caret position, and accessible listbox semantics;
- native `Input` plus native `NativeSelect`, with state-agnostic `TextField` and `NativeSelectField` compositions that own labels, descriptions, and stable validation relationships;
- shared `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` compositions for consistent form layout;
- a TanStack Form integration exposing `Form`, `useAppForm`, `TextField`, `NativeSelectField`, and `SubmitButton` adapters;
- state-agnostic primitive and sketch-dimension fields with separate TanStack Form adapters that preserve raw Quantity expressions, share variable completion through explicit value callbacks, publish transient draft state outside base controls, and submit through the shared single-flight action contract;
- a specialized SVG sketch canvas that receives one schema-valid analytical draft, delegates mutations, click-targeted analytical curve modification, and deterministic point, bounded-intersection, direction inference, and regular-polygon construction to pure domain operations, preserves retained curve identity while repairing detached endpoint dependencies, represents a split circle as complementary equal-radius arcs without redundant SolveSpace equations, persists accepted inference and polygon design intent as ordinary constraints, coalesces drag samples to one inference/render update per animation frame, exposes entity and stable-region selection, renders constraint and authored-dimension glyphs, and keeps solved display geometry disposable;
- Vitest and Testing Library coverage for the base and integrated layers.
