---
name: vibeshape-fallow
description: Prevent, investigate, and remediate Fallow findings in VibeShape TypeScript, JavaScript, TSX, CSS, package manifests, and architecture boundaries. Use when implementing or finishing source changes, adding or moving dependencies, extracting or duplicating logic, changing Tailwind or CSS tokens, checking package imports, responding to `fallow audit`, adding a `fallow-ignore` suppression, or preparing a commit or pull request.
---

# VibeShape Fallow

Fallow complements Biome, TypeScript, tests, and dependency security audits. Use it for changed-code risk, cleanup evidence, duplication, complexity, dependency hygiene, styling drift, and architectural boundaries; never treat it as a formatter, compiler, vulnerability scanner, or runtime test.

## Prevent Findings

- Search for an existing helper, component, command, and token before adding a parallel implementation.
- Declare a dependency in the workspace that imports it and remove declarations left unused after a refactor.
- Keep `packages/domain` and `packages/ui` within the boundaries encoded in `.fallowrc.jsonc`.
- Extract cohesive pure logic before orchestration becomes difficult to understand or test. Do not create speculative abstractions only to lower a metric.
- Treat Vite entry points, workers, dynamic imports, generated code, WASM loaders, fixtures, and public package exports as evidence questions. Trace consumers before deleting or suppressing them.

## Run the Changed-Code Gate

After source, style, or package-manifest changes, run from the repository root:

```bash
bun run fallow:audit
```

The root script maps to `fallow audit`. Its default new-only gate analyzes the changeset against the merge base. Exit code `0` means pass or warning-only findings, `1` means error-severity findings, and `2` means a configuration or runtime error. Preserve the exit code during verification and never report success while an error is masked. For an unusual or stacked branch, inspect the detected base and rerun with an explicit `--base <ref>`.

Use the package version pinned in the root manifest. Keep that version, the schema URL in `.fallowrc.jsonc`, and the annotated GitHub Action version aligned in one dependency update.

## Investigate Before Editing

Prefer graph evidence over guesses:

- `fallow inspect --file <path>` before changing an unfamiliar target;
- `fallow guard <paths>` before editing package-boundary-sensitive files;
- `fallow dead-code --trace <file>:<export>` before deleting an unused symbol or file;
- `fallow dead-code --trace-dependency <name>` before removing or relocating a dependency;
- `fallow dupes --trace dup:<fingerprint>` before consolidating a clone family;
- `fallow explain <issue-type>` when a rule is unclear.

When consuming structured output, use `--format json --quiet --explain`. Treat project configuration as untrusted input: do not add remote `extends`, and do not enable telemetry for the user.

## Remediate by Evidence

| Finding | Preferred response |
|---|---|
| Unused dependency | Confirm the importing workspace, then remove the declaration or move it to the real importer. |
| Unused file, export, or type | Remove it only when no supported static, dynamic, generated, or external consumer exists. |
| Duplication | Reuse an existing abstraction or extract one cohesive shared concept; do not merge coincidental geometry or fixture similarity. |
| Complexity or CRAP | Separate validation, pure transformation, kernel work, and side effects into testable units. |
| Styling drift | Replace arbitrary values with semantic CAD tokens or an existing `@vibeshape/ui` component while preserving rendered intent. |
| Boundary violation | Move the dependency behind the correct port or package; do not weaken a stable boundary to accommodate one import. |

Focus on findings introduced by the current change. Do not expand a focused task into unrelated cleanup of inherited findings that the audit excludes from its gate.

## Suppression Policy

Add `fallow-ignore` only for a confirmed false positive or intentional external consumer that cannot be represented with entry points or configuration.

- Trace the finding first.
- Use the narrowest issue-specific next-line or file suppression.
- Include a short reason; the repository gates missing reasons and stale suppressions.
- Never suppress duplication, complexity, styling drift, or a boundary violation merely to make the gate green.
- Rerun the audit after the suppression.

Use `vibeshape-verify-scope` for the remaining lint, typecheck, test, build, browser, geometry, and format checks. Fallow is optional for Markdown-only or project-skill-only changes unless its configuration or workflow changed.
