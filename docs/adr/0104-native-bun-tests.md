# ADR-0104: Native Bun Unit Tests

- Status: **Accepted**
- Date: 2026-10-08
- Supersedes the unit-test runner choice in [ADR-0008](0008-bun-workspaces.md).

## Context

The unit suite previously used Bun to launch Vitest, which executed tests in Node.js.
The full Mac fallback CI run 37824803699 spent 462.21 seconds in Vitest for
5,846 tests across 558 files. The user requested native Bun execution and the
latest stable Bun release.

## Decision

Pin Bun and its TypeScript definitions to 1.4.2. Run workspace and script unit
tests using Bun's native test runner. The root launcher selects the same
`.test.ts` and `.test.tsx` corpus as the previous configuration, fails when
no files match, and excludes remote MCP `.worker.test.ts` integration tests.
Run files in parallel with fresh globals and module registries; keep tests
within each file sequential. CI uses two worker processes and a 15-second
default test timeout. Use `bun run test <path-filter>` for focused checks
and `bun run test:watch` for watch mode.

The launcher separates DOM tests from Node-environment tests. DOM tests preload
jsdom before CommonJS Testing Library modules bind their queries; other tests
retain Bun's server globals. Both groups use isolated files. Watch mode starts
both groups. `--changed` allows an unaffected group to contain no tests, while
an invalid path filter still fails before either group starts. When both groups
run, JUnit files receive `.node` and `.dom` suffixes and coverage directories
receive `node` and `dom` subdirectories, preserving both reports.
Other runner flags apply per group. With `--bail`, a failed group prevents the
next group from starting; thresholds are per group, rather than a combined
failure counter across both groups.

Seed Bun's native scheduler with the per-file durations recorded in Mac CI run
37824803699 (`scripts/unit-test-timings.json`). This starts the expensive WASM
and OCCT files early and balances worker chunks by duration rather than file
count. These are historical Vitest measurements used for ordering, not Bun
speed claims. To refresh with native measurements, run
`bun run test --update-timings`; Bun merges both groups into the timings file.

Keep the official Cloudflare Workers Vitest pool for remote MCP integration
tests inside workerd. Keep Playwright for browser evidence and Vite for browser
builds. Execute compatible JavaScript CLIs in Bun explicitly; GitHub Actions
and tooling requiring Node.js retain their supported runtime.

## Consequences

- Preserve every scenario and the behavior it asserts; adapt runtime-specific
  mock metadata and fixture loading to Bun's APIs.
- Bun mock, timer, DOM, and module-loading behavior must pass the full corpus.
- A native Bun measurement is required before claiming a speed improvement;
  results from different hosts or resource limits are not a matched comparison.
- The Workers integration retains a scoped Vitest dependency because ordinary
  Bun unit tests cannot establish workerd behavior.

## Validation

The native suite passed on the same Linux ARM64 Mac runner container with four
CPUs, 6 GiB RAM, and two test workers: 5,859 tests across 561 files, including
all 5,846 original scenarios and 13 adapter conformance tests. The unit command
took 381.26 seconds (Node environment 319.01 seconds, DOM environment 62.13
seconds), versus 462.21 seconds for the previous Vitest run: about 18% less time.
This is one matched comparison, not a multi-run benchmark. Cloudflare workerd
integration separately passed all 46 tests.

The native DOM run also emitted 104 React `act` warnings. Independent review
found asynchronous fixture completion gaps, including Floating UI positioning
updates, without a demonstrated weakened assertion or failing scenario. Keep
these warnings visible; the green suite does not establish that every fixture
waits for all background UI updates to settle.
