# Local deployment

## Decision

Production VibeShape is a set of static files, but it cannot run through `file://`. It requires a local or self-hosted HTTP(S) server because module workers, WASM, service workers, and storage APIs depend on an origin and secure context.

## Modes

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

The launcher does not access projects and does not expose a backend API without a separate requirement. Browser launch and auto-update are packaging details, not CAD architecture.

## Acceptance criteria

- Clean install and offline reopen across the browser matrix.
- WASM loads with the correct MIME type.
- Core offline workflow makes no network requests.
- Updates do not lose an open document.
- Self-hosting requires no proprietary service.
- Licenses, source offers, and notices remain available offline.
- The storage origin is visible to users: changing host or port creates separate browser storage and must be explained.
