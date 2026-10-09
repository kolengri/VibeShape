# ADR-0106: Dependency-aware CI unit receipts and deployment preflight

Status: Accepted

Date: 2026-10-08

## Context

Native Bun tests still repeat the complete unit corpus on each CI run. The
repository includes expensive OCCT and Pyodide fixtures, workspace cycles,
undeclared relative test imports, and ignored generated runtime assets. A
changed-file filter cannot establish that an unchanged test has unchanged
dependencies. Cloudflare deployment protection also previously failed after
the full reusable CI workflow had already run.

## Unit-test decision

Keep `bun run test` as a complete uncached local command. Enable successful
workspace result receipts only with `bun run test --cache`. `--force` disables
all receipt reads and writes. Focused paths, changed-file selection, watch,
coverage, JUnit/report outputs, name filters, shards, retries, custom preloads,
timing updates, bail thresholds, and unknown runner options bypass caching.
Parallelism, timeout, scheduler inputs, and a fixed seed are fingerprinted
when a complete run uses them. Bypassed commands keep the existing Node/DOM
grouping, report suffixes, file isolation, timeout, and bail semantics.

Receipts live in `.turbo/unit-tests/v1/`, distributed through immutable CI
archives. They record complete package/environment test-file lists and only
successful native invocations. Corrupt or mismatched receipts miss. Writes
publish a complete temporary file through an atomic, exclusive filesystem
link, so concurrent writers cannot replace an existing receipt. Compare inputs
again after execution and refuse to publish results for changed inputs.

Reuse `scripts/workspace-graph.ts` for dependency closure, including development,
peer, optional, and cyclic workspace edges. Expand that closure for bare or
relative cross-package imports and literal filesystem assets. Include actual
source and test contents, package manifests, new/deleted/untracked/ignored
fixtures, shared root scripts/configuration/support/documentation, lockfiles,
the complete installed dependency store, and Bun version/revision/platform/
architecture. Hash SolveSpace's package runtime, bundled fonts, installed
OCCT WASM, prepared `.artifacts/structural-runtime`, and controlled
`.artifacts/occt-build/package` contents directly. Prepare and verify pinned
Pyodide assets before the first cache snapshot. Generated test reports and
cache directories are outputs rather than source inputs.

Follow native test and actual preload imports recursively through shared root
modules into workspace sources. Hash whole transitive packages, including their
tests, while following executable dependency boundaries from selected entries.
Every selected test must be a hashed, parsed input; tests under excluded output
directories still execute and make their workspace uncacheable.

The installed TypeScript 7 async native API supplies ASTs using an isolated
in-memory source program. One parser child belongs to each snapshot and closes
on success or failure; parser failures disable receipt reuse. The version-only
TypeScript root export and Node-specific synchronous API are not used.

Resolve finite literal filesystem paths, immutable local constants, native
module URLs, and imported path helpers with their actual path semantics.
Unknown filesystem arguments, unsupported readers or reader aliases, computed
`require`, resolver mutation/escape, unparsed source, missing/unhashed inputs,
repository-external imports, home-directory readers, and explicit CI transport
metadata readers cannot seed receipts. Hash the child working directory too.
Known subprocess/network APIs, dynamic code/interpreter APIs, unresolved worker
scripts, and unsupported global/module loader aliases also fail closed. Finite
native worker URLs become reached source inputs and retain transitive imports.
Node/Bun builtin providers use positive admission: only reviewed pure providers
and already modeled providers may participate. Unknown providers, including
SQLite, are uncacheable. Filesystem/process/module/Bun references likewise admit
only modeled members; installed third-party imports retain the explicit SDK
trust boundary. The exact structural quick-WASM caller may record RSS into its
output-only matrix after assertions, under its coupled caller/producer pins.
Worker options permit only a static module-type object; preload, computed,
spread, and other unsupported options disable reuse. Imported Vite worker
factories permit only argument-free construction, so the pinned wrapper cannot
forward an unhashed preload or arbitrary caller options. Nested global builtin
namespaces and unsupported factory aliases are also uncacheable.
Dynamic/namespace worker-factory imports and re-exports bypass reuse rather than
requiring constructor-alias dataflow analysis.

Reviewed source-content pins in `scripts/unit-test-source.ts` and
`scripts/unit-test-runtime-policy.ts` cover the three
existing computed OCCT/Pyodide loaders, the formats test's bundled font reader,
and the engine import test's fetch-to-file bridge together with its engine
producer's installed-WASM fetch. Structural preparation calls require exact
caller, checksum-verified preparation script/runtime descriptor, and executed
Python producer bytes; `PATH` must resolve `bun` to the runner's executable.
Exact DOM/mock helper and formats WebCrypto producer pins permit their inspected
global reflection. The exact Vite preload permits its closed, lazy worker mock
factory; actual caller imports and worker URL targets still enter the closure.
Complete corresponding runtime trees, installed WASM, and package font bytes
are hashed. Any edit to a pinned boundary requires another review.
This preserves heavy geometry/structural receipts after unrelated UI edits.
Arbitrary new external I/O requires an explicit input boundary or an uncacheable
scope; hashing an external path string does not cover the file's contents.
The policy trusts the installed SDK/runtime behavior and these inspected source
boundaries. It is a test-input cache policy, not a sandbox for arbitrary
third-party code. Dependency/source pin maintenance is an explicit cost of
retaining heavy runtime cacheability without general interpreter analysis.

Cacheable workspace children receive a controlled environment that removes
GitHub/runner/action/agent transport metadata, shell bookkeeping, and terminal
formatting variables. Hash every value actually passed to those children,
including unknown custom variables and values read indirectly. Root script
tests always execute with the complete original environment because they
inspect Git history, deployment state, and other external inputs. Workspace
scopes with unsupported inputs also execute with that original environment.
These children retain native Bun file isolation and the Node/DOM preloads.
The controlled environment is specific to complete cached CI runs; ordinary,
partial, reporting, watch, and forced runs retain their inherited environment.

Keep workerd integration as the separate, always-running remote MCP suite.
Keep all unit scenarios; a receipt is reuse of a demonstrated complete package
result, not permission to remove or weaken tests. A native process crash is a
failed invocation and cannot seed a successful receipt.

## Existing cache engine

Turbo remains the typecheck cache engine. Most workspaces do not own unit-test
scripts; the root native launcher owns file discovery, preloads, grouping,
worker scheduling, and report output. Routing these groups through Turbo would
require new workspace command contracts plus explicit ignored/WASM input
coverage. The small native receipt layer retains that existing launcher
interface and reuses the shared workspace graph instead of creating parallel
package scripts or changing the test runner.

## Deployment preflight

Run Cloudflare preflight before its full reusable verification job. Verify
required kernel assets and that the push targets the current main commit.
Preserve the later current-head and verified-build checks. Destination
configuration remains checked by the publication job because production
environment values need not be visible to the unprivileged preflight job.

If preflight fails, skip deployment verification and run the existing reusable
CI workflow once in a separate cache-warming job. This preserves default-main
typecheck/unit archive seeding. A preflight failure becomes visible quickly;
a first cold cache-warming run still consumes the required full verification
time. When preflight succeeds, deployment verification performs that one full
CI invocation instead. Full CI and artifact verification remain required.

On 2026-10-09 the owner approved removing mandatory GitHub branch protection
from preflight, build and publication because it is unavailable for this private
repository on GitHub Free. Build and both publication jobs still reject a stale
main SHA. This permits deployment without GitHub enforcing PR-only changes;
verified PRs remain the repository workflow.

## Runner resources and evidence

Use available CPUs for native self-hosted Mac CI workers through
`os.availableParallelism()`; hosted CI retains two workers. The Mac currently
exposes eight CPUs. Newly created runner containers have no explicit CPU or
memory caps, and the existing container is updated to the available OrbStack
VM pool. The current pool is about 16 GiB. These settings use the user's
authorized host resources; they are not measured throughput claims.

The focused cache contracts validate own/transitive/relative/global/runtime
invalidation, unrelated-package stability, failure/corruption/concurrent writes,
full-run flag restrictions, controlled environment inputs, always-running
script/metadata scopes, native Node/DOM execution, and actual JUnit paths.
Full native cold/warm, workerd, and CI evidence must be reported separately.
Changing runner capacity prevents attributing a timing change solely to cache
logic or worker count. A failed baseline cannot support a speed comparison.

## Consequences

- Warm compatible CI runs can reuse complete successful workspaces while
  scripts and uncacheable inputs continue executing.
- Installed-dependency content hashing and broad shared inputs add startup
  cost and conservative invalidation; correctness takes precedence over a
  narrower undocumented dependency boundary.
- Shared configuration, support, dependency bytes, runtime upgrades, or
  environment changes invalidate receipts even when test filenames match.
- Pinned computed loaders and fixture bridges require renewed review after edits.
- Local test behavior, workerd integration, browser evidence, production
  publication destination/identity checks, and the original scenario corpus remain required.
