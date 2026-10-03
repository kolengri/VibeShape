# Local deployment

For the separately configured static website and protected-branch GitHub Actions pipeline, see
[Cloudflare deployment](cloudflare-deployment.md). Local packaging remains independent of hosting.

## Decision

Production VibeShape is a set of static files, but it cannot run through `file://`. It requires a local or self-hosted HTTP(S) server because module workers, WASM, service workers, and storage APIs depend on an origin and secure context.

## Modes

### Verified local MCP delivery

The external agent owns natural-language reasoning. VibeShape exposes typed CAD tools over stdio;
it does not require an embedded chat, model API key, or paid inference backend.
See [MCP quickstart](mcp-quickstart.md) for client setup and the review workflow.
For the relocatable local package, explicit editor/MCP launch, versioned installation and rollback,
see [Local distribution](local-distribution.md). Packaging does not change the active MCP client
or register a new one.

Prepare a local build from the existing verified OCCT corresponding-source bundle:

```bash
bun ci
bun run prepare:local /absolute/path/to/vibeshape-occt-compliance-bb368e271e24
```

Without an argument the command uses `.artifacts/occt-build/compliance/` and the pinned bundle
name. If the bundle is unavailable, prepare it using the existing source-build and compliance
commands; the delivery command fails instead of falling back to the npm feasibility kernel.
It validates the complete bundle inventory and provenance, verifies the solver runtime and sources,
stages the verified kernel, and builds the editor in `controlled-occt` mode. It requires no download,
account, cloud deployment, or new credentials. The generated build includes `/local-build.json`
with kernel/source identities and WASM hashes, and `/sources/index.html` with the exact kernel and
solver sources, licenses, and replacement instructions. The accompanying checkout provides the
application source. This local preparation is not a public distribution compliance certification.

Configure the MCP client to start `bun apps/mcp-server/src/index.ts` using absolute paths.
The client owns the process lifetime. Open `http://127.0.0.1:43114`, enable the AI session, and
keep that tab open. Only one client may own that port; stop the previous client before connecting
another. Do not change the host or port to solve a port conflict: that would select different
browser storage. The server never exposes project files on a network interface.

For rollback, stop the owning MCP client, switch the isolated checkout to the previous accepted
commit, rerun `prepare:local` with the same source bundle, and reconnect at the same origin.
Export `.vshape` backups before upgrades. Never clear browser storage as a rollback step.
Restart loses uncommitted drafts and session Undo/Redo navigation; committed projects persist in
the browser. A lost commit response requires inspecting the current revision before retrying.

Auto-apply is an explicit opt-in for valid allowlisted CAD edits in one paired browser session;
it is off by default and ends on disconnect, reload, or project change. It grants no background
or cross-project authority. The current local delivery does not claim headless geometry, remote HTTP MCP,
full feature parity, or an installed/offline update lifecycle. Public hosting still requires the
release gates below and in [Licensing](licensing.md).

| Mode | Purpose | Network after installation |
|---|---|---|
| `localhost` static server | Fully local installation and development | Not required for core once assets exist |
| Self-hosted HTTPS | Home network, school, or organization | Required only for loading and updates; CAD remains local |
| Installable PWA | Desktop-like launch and offline use | Core works offline after the first successful installation |
| Public static host | Convenient delivery | Project files are still processed locally |

A Tauri or Electron wrapper is unnecessary for v1. A later wrapper MAY package the same web build but cannot create a separate product-logic path.

## Required server behavior

- Correct MIME type for `.wasm`: `application/wasm`.
- Correct MIME types for JavaScript modules and manifest.
- Immutable caching for content-hashed assets.
- Revalidation or no-cache for entry HTML and service-worker control files.
- SPA fallback only for UI routes, never for assets and file formats.
- Content Security Policy and security headers.
- Deployments that expose the optional desktop slicer handoff add only `http://127.0.0.1:43113` to `connect-src`; deployments without that integration omit it.
- Byte ranges only when a measured large-asset strategy needs them.
- Brotli or gzip for JS/WASM without recompressing ZIP/3MF.
- No runtime CDN dependencies.

## Secure context

Modern browsers treat `localhost` as a secure context for many APIs. Self-hosting over a network requires HTTPS. Feature-detect every capability instead of inferring it from protocol or user agent.

## COOP and COEP

The baseline does not require `SharedArrayBuffer` or multithreaded WASM. If profiling proves threads are necessary:

- add `Cross-Origin-Opener-Policy: same-origin`;
- add `Cross-Origin-Embedder-Policy: require-corp` or a reviewed credentialless policy;
- self-host all subresources with correct CORP/CORS;
- test popups, embedding, authentication, and third-party integrations;
- record the change in a separate ADR.

Do not enable cross-origin isolation speculatively; it changes hosting and integration constraints.

## Offline and update flow

1. First load obtains the versioned application shell, worker, and WASM.
2. Service-worker precache completes and reports offline readiness.
3. A new build downloads in the background.
4. Activation waits while a dirty project is open.
5. The UI offers snapshot save or recovery export before reload.
6. Storage migrations run backup-first after reload.
7. Failure preserves the previous semantic snapshot and follows the tested application-shell rollback strategy.

## Future local distribution

A release MAY include:

- static archive;
- a small open-source local-server launcher;
- checksums and signatures;
- SBOM and OCCT/SolveSpace source bundles;
- Windows, macOS, and Linux instructions.

Production web builds, Playwright browser matrices, OCCT and SolveSpace source builds, native evidence, stable topology evidence, persistence and extension corpora, and corresponding-source bundle generation run on reviewed local hardware, not the ordinary GitHub pull-request workflow. Dedicated heavy entry points fail when a truthy `CI` environment is present. A release consumes locally generated artifacts only after their verification and records manifests and checksums with the release evidence.

The explicitly enabled Cloudflare production workflow may build the browser application from an
already verified, checksum-pinned OCCT bundle and run the bounded Chromium package smoke. It does
not compile OCCT or SolveSpace, generate their compliance bundles, or replace the locally verified
geometry and browser matrix. PR validation receives no deployment credentials.

The launcher does not access projects and does not expose a backend API without a separate requirement. Browser launch and auto-update are packaging details, not CAD architecture.

## Acceptance criteria

- Clean install and offline reopen across the browser matrix.
- WASM loads with the correct MIME type.
- Core offline workflow makes no network requests.
- Updates do not lose an open document.
- Self-hosting requires no proprietary service.
- Licenses, source offers, and notices remain available offline.
- The storage origin is visible to users: changing host or port creates separate browser storage and must be explained.
