# Contributing to VibeShape

Before implementation begins, changes must preserve the boundaries defined by the documentation.

## Local setup

Install the exact Bun version declared by `packageManager`, then run:

```bash
bun install
bun run check
```

Use `bun run dev` for the Vite application and `bun run test:e2e` for the Chromium smoke test. Keep `bun.lock` synchronized with every manifest change and verify it with `bun ci` before opening a pull request.

## Language policy

- Write all documentation, ADRs, source identifiers, commit messages, diagnostics intended for developers, tests, and code comments in **English**.
- Product UI strings must use the localization layer once one exists; the canonical source copy is English.
- Add canonical product copy to the English ICU catalog; every translated catalog must preserve its keys and placeholders.
- Do not add bilingual comments or duplicate English and translated documentation in the same source file.
- External source titles may retain their original registered names, but explanations remain in English.

## Engineering rules

- Propose changes to the kernel, solver, license, native format, history model, or local-first model through an ADR.
- Do not add CAD assets without provenance and a compatible license.
- Every geometry change requires fixtures plus invariant and failure tests.
- Never use face order, edge order, or triangle order as stable identity.
- Do not introduce mandatory networking or telemetry.
- Do not concatenate translated fragments or use localized labels as domain, command, persistence, or diagnostic identifiers.
- Update `docs/research-sources.md` when an external technical basis changes.
- Pin dependency versions in the lockfile; WASM builds record the upstream commit, build flags, and checksum.
- The only JavaScript lockfile is `bun.lock`; workspace dependencies use `workspace:*`, and CI uses `bun ci`.
- Add shadcn components selectively and review them as project-owned source; `add --all` and blind overwrite are prohibited.
- Run `bun run fallow:audit` after source, style, or package-manifest changes and investigate reported consumers before deleting or suppressing code.
- Do not combine unrelated refactoring and feature work.

## Contribution license

By submitting a contribution, the author agrees to license it under GPL-3.0-or-later, the same license as the repository. Before public contributions are accepted, the project will add a DCO/sign-off workflow.

## Documentation changes

Verify:

- links and review date;
- consistency with accepted ADRs;
- clear separation of confirmed facts, goals, estimates, and assumptions;
- roadmap and risk updates when scope changes;
- no compatibility claim without test evidence;
- no non-English repository prose or code comments.
