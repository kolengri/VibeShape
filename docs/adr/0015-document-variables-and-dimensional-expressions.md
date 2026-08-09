# ADR-0015: Document Variables and Dimensional Expressions

- Status: **Accepted**
- Date: 2026-08-09

## Context

Configurable models need named values that can drive multiple feature parameters. Storing only the latest numeric result loses design intent, while evaluating arbitrary JavaScript would make native documents executable, non-portable, and unsafe. A variable contract also affects event replay, geometry identity, worker recovery, persistence, automation, and future extension feature types.

## Decision

VibeShape stores authored document variables as semantic records with a stable UUIDv7 ID, a case-sensitive ASCII name, and a normalized expression source. Expressions refer to variables with `#name`; names are not identity, and a future rename command must preserve the ID and atomically refactor every known reference.

Committed variable tables must evaluate successfully. Dependencies may point forward or backward in presentation order, form a directed acyclic graph, and are evaluated independently of table order. The table is limited to 4,096 definitions, each source to 256 characters, parentheses to depth 32, and dependency traversal to depth 256. Duplicate IDs, duplicate names, missing references, cycles, non-finite results, division by zero, unsupported units, invalid syntax, excessive complexity, and invalid dimensional operations reject the command or document boundary. Invalid raw input belongs to a disposable UI or automation draft, not the committed snapshot.

Expression schema version 0 supports:

- finite decimal and scientific-notation literals;
- `um`, `mm`, `cm`, `m`, `in`, `ft`, `deg`, and `rad` unit suffixes;
- `#variable` references;
- unary `+` and `-`, binary `+`, `-`, `*`, and `/`, and parentheses;
- length, angle, and scalar results using canonical millimeters, radians, and scalar identity;
- addition and subtraction only for equal dimensions;
- multiplication only when at least one operand is scalar;
- division by a scalar, or equal-dimension division producing a scalar.

Exponentiation, functions, compound dimensions such as area, persisted ASTs, localized serialized input, and arbitrary code are not part of schema version 0. Adding any of them requires a versioned grammar and cross-browser determinism evidence.

Feature quantities retain the authored expression text and their last validated source-unit value. A trusted feature-type handler resolves its owned parameters against the current variable table before validation and rebuild. The resolved canonical value, not the variable name or expression formatting, enters feature content identity. Therefore a variable edit rebuilds only features whose resolved semantic parameters change, plus their descendants. Unknown feature payloads remain untouched unless their exact handler is available.

Variable add, expression update, and removal use the ordinary revisioned command/event path. Initial commands do not rename variables. Removal is rejected while another variable or a standard quantity parameter references the name. Event replay evaluates the same project-owned grammar and never requires React, persistence, a geometry kernel, an extension runtime, or network access.

Document protocol version 2 carries the bounded authored variable table to the document worker. The worker evaluates variables and resolves trusted feature parameters before canonical hashing and OCCT execution. Worker restart recovery replays the last successful semantic snapshot, including variables; native and mesh state remain disposable.

## Consequences

- A model can expose one variables table and reuse its values across supported feature parameters.
- Human-readable `#name` sources remain portable while UUIDv7 preserves variable identity.
- Formatting-only expression edits can advance the semantic document revision without invalidating geometry.
- Feature-module handlers own parameter resolution, so unavailable extension payloads are preserved rather than guessed.
- The UI needs an uncontrolled editing buffer and table-level validation before committing one ordinary command.
- A future atomic rename/refactor command, richer grammar, variable reordering, display-unit preferences, and extension ABI support remain explicit follow-up work.
