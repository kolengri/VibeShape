# Internationalization

## Purpose

This document defines how VibeShape authors, resolves, renders, persists, and verifies user-facing language. English remains the canonical source language for product copy, documentation, diagnostics, and code.

## Architecture

`@vibeshape/i18n` is a browser-compatible React workspace built on `use-intl`:

```text
packages/i18n/
  src/
    catalog.ts      # catalog merge and parity checks
    locale.ts       # pure locale resolution and safe preference storage
    provider.tsx    # React provider and runtime locale control
    index.ts        # instance factory, formats, and typed hook exports

apps/web/src/i18n/
  index.ts          # application instance and available catalogs
  global.d.ts       # typed Locale, Messages, and Formats augmentation
  messages/en.json # canonical product copy
```

`packages/i18n` has no dependency on the application, UI package, domain, persistence, or CAD engine. The web composition root supplies the i18n instance before rendering product components.

## Locale resolution and persistence

The provider resolves the first supported locale from:

1. explicit `initialLocale` supplied by the composition root;
2. the local `vibeshape-locale` preference;
3. `navigator.languages`, including base-language matching such as `de-DE` to `de`;
4. the configured English fallback.

A runtime change accepts only an available locale, updates `<html lang>` and `<html dir>`, and writes the preference to `localStorage`. Blocked or unavailable storage is non-fatal. Locale is UI preference state: it never enters `.vshape`, undo/redo, geometry commands, or project persistence and never requires network access.

## Catalog ownership

- English is the source of truth for keys, placeholders, terminology, and fallback behavior.
- Application copy lives under the `app` top-level namespace.
- A shared package that needs its own copy owns a distinct top-level namespace such as `ui`.
- `mergeMessages` rejects duplicate top-level namespaces instead of silently overwriting one catalog with another.
- Keys describe stable meaning and location, not the current English wording.
- Domain IDs, command IDs, diagnostic codes, units, file-format names, and persisted enum values are not translated.

The initial implementation ships only `en`. Adding a locale means adding a complete catalog and including it in the application `messages` map; no provider change is required.

## Message rules

- Use ICU messages for values, pluralization, selection, numbers, dates, and times.
- Do not concatenate translated fragments or rely on English word order.
- Keep accessible names, descriptions, status messages, validation, recovery actions, and visible labels in the same catalog contract.
- Preserve official names such as VibeShape, STEP, STL, 3MF, OCCT, and millimeter unit symbols.
- Do not translate raw developer diagnostics; translate the stable user-facing explanation associated with a diagnostic code.
- Component tests may use inline synthetic catalogs, but production copy belongs in JSON catalogs.
- Copy-free shared primitives require localized labels from their owner instead of embedding an English fallback.

## Verification

Each locale must:

- contain exactly the English leaf keys;
- preserve the same ICU placeholder tokens;
- compile through typed `useTranslations` calls;
- pass locale resolution, fallback, persistence, and `<html lang>`/`dir` tests;
- pass keyboard and accessibility tests with localized accessible names;
- fit the 1024 px authoring layout, 200% zoom, and representative expanded labels;
- work with the network disabled.

Catalog parity does not prove translation quality. Human review must preserve CAD terminology, error meaning, unit semantics, ellipses, and specific action verbs.
