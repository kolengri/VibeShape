# ADR-0011: use-intl localization layer for the static React application

- Status: **Accepted**
- Date: 2026-08-07

## Context

VibeShape needs type-safe product copy, ICU formatting, locale persistence, shared-package catalogs, and future language switching without introducing a backend. The Dealyv platform demonstrates a useful structure with a dedicated i18n package, nested JSON messages, shared UI namespaces, typed keys, locale persistence, and catalog parity tests. Its `next-intl` server and cookie layer is specific to Next.js and cannot be copied into VibeShape's static Vite application.

## Decision

Use `use-intl`, the framework-agnostic React foundation of `next-intl`, behind a dedicated `@vibeshape/i18n` workspace.

- English is the canonical source catalog.
- Applications augment `use-intl` types from their English catalog and access messages through `@vibeshape/i18n` exports.
- Catalogs use nested JSON and ICU message syntax.
- Independently owned catalogs use distinct top-level namespaces and are combined with `mergeMessages`.
- Locale resolution checks an explicit initial value, local preference, browser language, and the English fallback in that order.
- Locale changes persist in browser storage and update the document language without changing CAD document state.
- Every added locale must match English keys and placeholder tokens.

## Consequences

- Product components no longer own hard-coded display copy.
- Locale selection remains entirely local and works offline.
- Missing or malformed messages stay visible as developer diagnostics instead of silently changing domain behavior.
- The first production catalog is English only; translated catalogs and a locale selector can be added independently.
- `use-intl` and its ICU formatter are browser-shipped dependencies and require license notices and bundle review.

## Rejected Alternatives

- `next-intl` would introduce Next.js-specific server, routing, and cookie assumptions that do not fit the Vite application.
- A project-owned message formatter would duplicate ICU parsing, pluralization, and React integration.
- Hard-coded English followed by later extraction would allow copy and accessible names to become part of component APIs and tests.
- Using translated labels as command or domain identifiers would make persistence and behavior locale-dependent.
