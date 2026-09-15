# ADR-0045: Local MCP Variables and Chamfer

- Status: Accepted
- Date: 2026-09-07
- Related: [ADR-0044](0044-local-mcp-cad-authoring-and-inspection.md), [ADR-0017](0017-atomic-variable-rename-and-reference-refactor.md)

## Decision

Extend the paired local adapter with eight named tools: `model_variables`, `create_variable`,
`set_variable_expression`, `rename_variable`, `remove_variable`, `replace_variable_table`,
`create_chamfer`, and `update_chamfer`. Discovery now contains twenty-five tools. Shared schemas
remain in `packages/automation-api`; the browser translates mutations into existing registered
variable and feature commands. The server retains transport authority only.

Variable mutation inputs require a draft ID, current draft revision and fresh UUIDv7 command ID.
Definitions, names, expressions and replacement tables reuse the domain schemas. Stable IDs survive
rename; ordinary domain handlers own dependency refactoring, dimensional validation, referenced
removal protection and atomic table replacement. Expressions remain authored model data, never
executable code or instructions to a client.

Chamfer uses the existing all-edge version 1 feature with an explicit target feature and positive
`distanceMm`. Optional `distanceExpression` is authoritative: ordinary CAD resolution evaluates it
against the draft's variable table, replacing the supplied numeric value. Fillet receives the same
optional behavior through `radiusExpression`. Omitting an expression authors a literal. Updating a
treatment replaces its supplied intent; it does not implicitly merge omitted fields. Selected-edge
version 2 tools remain separate work pending a revision-bound durable-reference inspection query.

Invalid geometry remains repairable in the disposable draft. Exact preview and commit use the
existing worker path; invalid commit cannot reach browser review. Valid commit still requires browser
Apply, replays original commands through ordinary persistence, and creates one Undo transaction.
No history, persistence, geometry protocol or document schema version changes are introduced.

## Inspection and bounds

`model_variables` maps to the existing registered `org.vibeshape.variable.list` semantic query.
It returns authored definitions, evaluated values with canonical units, dependencies and a cursor,
for at most 200 variables at the exact requested committed revision. The browser injects the paired
document identity; the broker independently checks successful result identity and revision.
Other documents, stale revisions and invalid cursors fail explicitly.

Variable pages are capped at 128 KiB. An oversized page returns `query-result-too-large`; the client
can request fewer records. No silently truncated definition or dependency list is exposed. The existing
192 KiB serialized operation limit also applies to whole-table replacement. Large document tables
may require successive named mutations rather than one oversized replacement command.

The new query is read-only and idempotent. Variable and treatment mutations remain draft commands;
preview retains its existing non-idempotent metadata because it renews expiry.

## Verification gate

Require a real stdio client to create variables and a box, reject an impossible chamfer, repair it
with an authoritative variable expression, preview exact geometry, and commit through browser Apply.
Inspect variables and the retained feature expression, reject stale reads, change a variable and
verify geometry changes, then Undo and reopen to recover the previous formula and geometry.
Exercise rename, removal and table replacement in disposable work. Run Chromium, Firefox and WebKit.

Contract tests must check command routing and identity, expression retention, malformed/cyclic
inputs, inspection result identity, serialized page bounds and smaller successful pages. Run
workspace types, unit tests, format/lint, changed-code audit and production build.

Verification on 2026-09-07 passed:

- `bun run test --maxWorkers=4`: 1,723 tests in 215 files. After the final query projection
  extraction, the owning query suite passed all 19 cases again.
- `bun run test:e2e` with `--workers=3` over `local-mcp`, `local-mcp-cad`,
  `local-mcp-variables`, `local-mcp-cancellation`, `local-mcp-protocol`, `local-mcp-visual`,
  `automation-document-commit`, `automation-document-cancellation`, `automation-review` and
  `automation-draft-geometry`: all 63 cases passed in one Chromium/Firefox/WebKit run.
- Full workspace typechecking passed; the automation API typecheck passed again after extraction.
- Formatting, lint, production build, English/local-link checks and `git diff --check` passed.
- The changed-code Fallow audit exited 0 with the two previously investigated Bun transitive
  override warnings. The build retains its known chunk-size/dynamic-import warnings; neither
  check constitutes release performance certification.

The initial new browser fixture attempted an identical table replacement and correctly received a
no-op rejection. The final fixture replaces the table with a different value, checks the resulting
geometry, discards it, and verifies the committed table stayed unchanged. Invalid Chamfer commit is
rejected before review. Repair deliberately supplies a mismatched numeric size to prove that the
retained expression controls geometry. Undo produces a new revision; reopening reconnects the AI
session and verifies both the restored expression and geometry.


## Remaining scope

Selected-edge inspection and repair, remaining primitive/boolean/reference commands, profile and
draft record inspection, durable tool provenance, constituent-body identity, broader CAD features,
workflow coverage, installation/offline recovery and release performance gates remain open.
