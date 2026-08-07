---
name: vibeshape-type-guards
description: Select, implement, or review TypeScript runtime narrowing in VibeShape. Use when adding `value is Type` predicates, parsing unknown worker or file data, filtering nullable arrays, checking geometry handles, reviewing casts, deciding between a local guard and Zod, or adding reusable guard behavior to a shared package.
---

# VibeShape Type Guards

## Decision Order

1. Define accepted and rejected runtime values, including nullish, empty, whitespace, non-finite, malformed, stale, and unsupported cases.
2. Search for an existing guard or Zod schema and inspect its tests and call sites.
3. Use Zod at trust boundaries: worker messages, native files, migrations, imported metadata, persisted records, and external payloads.
4. Use a named type guard for small runtime-kind checks inside an already validated boundary.
5. Keep a guard local when its meaning belongs to one module. Move it to the narrowest shared package only after real reuse appears.

Do not create a generic `utils` package as a default destination. Domain semantics belong in `packages/domain`; protocol and file semantics belong with their schemas.

## Guard Rules

- Accept `unknown` unless narrowing a deliberately smaller union.
- Return an honest predicate: every `true` result must satisfy the target at runtime.
- Avoid assertions used only to force TypeScript narrowing.
- Distinguish finite numbers from `number`; CAD parameters must reject `NaN` and infinities at boundaries.
- Distinguish an object-shaped value from a valid ID, entity reference, topology reference, vector, or command.
- Never use a handwritten shallow guard as a substitute for schema validation of a versioned object.
- Do not validate OCCT or WASM handle lifetime with TypeScript types alone; enforce ownership in the adapter.

## Tests

Cover representative accepted values plus null, undefined, wrong primitive kinds, empty boundaries, non-finite numbers, malformed nested values, unknown schema versions, and any semantic edge case named by the guard. Verify inferred narrowing without a cast.

Use `vibeshape-testing` for the correct layer and `vibeshape-verify-scope` after implementation.
