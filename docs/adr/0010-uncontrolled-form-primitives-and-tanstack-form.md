# ADR-0010: Uncontrolled-first form primitives with TanStack Form adapters

- Status: **Accepted**
- Date: 2026-08-07

## Context

VibeShape needs compact parameter forms, validation, async submission, field groups, and typed values without coupling every visual primitive to one form library. Controlled-only components make isolated native use harder, duplicate event logic, and encourage application state inside the shared design system.

The existing Dealyv platform pattern demonstrated that TanStack Form's `createFormHookContexts`, `createFormHook`, field components, and form components provide a practical typed adapter layer. VibeShape also needs stricter separation between base controls and adapters plus a shared single-flight action contract.

## Decision

Build native, state-agnostic form components in `@vibeshape/ui` first. They use uncontrolled native behavior by default and accept ordinary controlled props only so an integration can bind them without duplicating markup or styling.

Use TanStack Form for product form state through the separate `@vibeshape/ui/integrations/tanstack-form` export. The adapter owns field and form contexts, value binding, validation metadata, dirty/submitting state, and the integrated submit control. Base components never import TanStack Form.

Async Button handlers use a single-flight pending state and suppress duplicate pointer activation. TanStack submission exposes its own `isSubmitting` state through the same Button loading API.

## Consequences

- Base inputs remain usable without TanStack Form and preserve native form behavior.
- Product forms get typed field names, reusable adapters, focused subscriptions, validation metadata, and async submission state.
- Base and adapter behavior require separate tests.
- TanStack Form becomes a browser-shipped dependency of the shared UI integration.
- New field families must implement the base primitive before their TanStack adapter.
- Feature-specific parsing, command dispatch, persistence, and diagnostics remain outside `packages/ui`.
- CAD-specific compositions follow the same boundary in `apps/web`: the base Box parameter panel accepts ordinary field nodes, while its TanStack Form adapter owns raw expressions, validation, asynchronous submission, and feature construction. The same adapter has explicit create and edit modes; edit initializes from authored quantity source expressions and constructs a full replacement record without changing feature identity or untouched fields.

## Rejected Alternatives

- Importing TanStack Form directly into every input would reverse the desired dependency direction and make native use unnecessarily expensive.
- A project-owned form state library would duplicate validation, subscription, and type-safety work without a CAD-specific advantage.
- Controlled-only primitives would make default native behavior and progressive enhancement harder to preserve.
- Copying a reference Button that enters loading for every synchronous click would add flicker and still fail to guarantee safe async settlement or duplicate suppression.
