# Security and privacy

## Trust model

The user trusts the installed static VibeShape build but does not need to trust imported `.vshape`, STEP, STL, SVG/DXF, or 3MF files or third-party extension packages. Every import and extension is potentially hostile structured, binary, or executable input.

Local-first design reduces CAD-file disclosure but does not eliminate supply-chain risk, parser vulnerabilities, resource exhaustion, browser-storage loss, or unsafe disclosure through an explicitly connected automation client.

## Privacy by default

- No mandatory account.
- No telemetry, analytics, or error upload without opt-in.
- Self-host all assets, fonts, WASM, and documentation.
- Never send CAD files to the network.
- Open external links only after a user action.
- Generate diagnostic bundles locally and show their contents before export.
- Exclude project names, absolute paths, and previews from logs by default.
- Optional update checks cannot access document content.

CI E2E blocks networking after installation and runs the core workflow.

## Content Security Policy

Production goal:

- `default-src 'self'`;
- scripts, workers, and WASM only from the application origin;
- no `unsafe-eval`;
- `object-src 'none'`;
- `base-uri 'none'`;
- `frame-ancestors 'none'` or an explicit self-hosting policy;
- `connect-src 'self'` plus opt-in endpoints only if they appear;
- mixed-content blocking;
- Trusted Types when compatible with the build and tools.

Phase 0 validates the exact CSP against Emscripten and Vite output. A build requiring `unsafe-eval` is treated as a build problem.

## Worker isolation

- Parser and CAD computation have no DOM access.
- Versioned schemas validate input before allocation or OCCT calls.
- Every request has timeout and generation cancellation.
- Worker crashes are contained and recover from committed state.
- `SharedArrayBuffer` and multithreaded WASM are disabled in the baseline.
- COOP/COEP requires a separate ADR because it changes deployment and embedding.

A worker is not a security sandbox against compromised same-origin code. XSS remains critical.

## Extension isolation

The target extension platform is specified in [Extension architecture](architecture/extensions.md). SPK-006 accepts only immutable packages, no-import WebAssembly features, deny-by-default capabilities, restricted states, and opaque-origin iframe UI. The production application still does not execute third-party code because the modeling ABI, portable memory policy, document transaction, update/rollback, and recovery gates remain open.

- Native projects never embed auto-executable JavaScript, WebAssembly, HTML, or remote loaders.
- Opening a project never installs, enables, grants, updates, or downloads an extension.
- Parametric feature modules receive no network, clock, randomness, DOM, storage, file, clipboard, or raw-kernel authority.
- Arbitrary same-origin workspace JavaScript is disabled; a dedicated worker still has ambient network, clock, randomness, IndexedDB, and Cache Storage authority.
- Custom UI uses an opaque-origin sandboxed iframe with extension-specific CSP; it cannot mount into the application DOM.
- CPU-bound extension code runs in a terminable worker or stricter runtime with time, memory, message, output-size, and restart budgets.
- Every package is structurally validated, content-addressed, and integrity-checked before installation.
- Publisher signatures identify an artifact source but never replace isolation, least privilege, resource limits, or review.
- Restricted mode disables executable third-party entry points while preserving documents and unknown feature payloads.
- Installed, enabled, and granted are separate states; capability expansion on update requires new approval.

Extension packages use the same archive defenses as native files and additionally reject undeclared executable entries, incompatible API versions, invalid entry points, and checksum mismatches. Exact network origins and reasons are declared in the manifest and shown before a grant. Wildcards are prohibited in the initial capability model.

An extension failure is contained to its host. It cannot commit a partial domain command or geometry result, and revocation terminates active hosts. Diagnostics identify the extension ID, version, integrity digest, entry point, capability, and resource limit without including document content by default.

The current memory-growth fixture is terminated after exceeding its message budget. This is containment evidence, not a browser-independent hard memory quota; production executable support must close that gap explicitly.

## Automation and MCP isolation

The target local AI integration is specified in [Automation and MCP architecture](architecture/automation-and-mcp.md). MCP terminates in a local adapter and never becomes a privileged API inside domain, geometry, persistence, or extension packages.

- Pairing is explicit, revocable, and scoped to selected open documents.
- The initial server uses MCP `stdio` and serves the reviewed static application build plus browser session endpoint from one stable `127.0.0.1` origin in automation mode.
- The loopback endpoint validates exact `Host` and `Origin` values, authenticates every request with a session credential outside URLs, applies strict size and rate limits, and provides no wildcard CORS.
- Resources are bounded, revision-tagged serializable views; pairing never exposes other tabs, the project library, raw files, paths, tokens, or private extension storage.
- Tools are generated only from host-approved schema-backed commands and cannot access application stores, browser storage, file internals, raw kernel state, or extension management.
- Write tools modify disposable drafts. Commit requires a matching base revision and host-owned policy or confirmation, then records ordinary undo history and MCP actor provenance.
- Tool annotations are treated as advisory. VibeShape enforces read-only, destructive, idempotent, open-world, capability, and confirmation behavior independently.
- Cancellation, disconnect, timeout, invalid output, and worker failure cannot publish partial geometry or persistence state.
- Tool descriptions, model output, extension metadata, imported text, and document names are untrusted content and cannot alter host policy or confirmation copy.

Connecting an independently hosted PWA, Streamable HTTP, and remote access are disabled in the initial bridge. Cross-origin local pairing requires CSP, mixed-content, CORS, Private Network Access, DNS-rebinding, and browser-matrix evidence. A later HTTP MCP transport also requires a separate deployment threat model, Origin validation, authentication, secure session handling, token audience checks, and the current MCP authorization profile.

## Import policy

- Check magic bytes, not only extension or MIME type.
- Enforce resource limits before decompression and allocation.
- Normalize ZIP paths and reject duplicates.
- Parse XML without DTDs or external entities.
- Never insert SVG as live DOM; convert a safe geometry subset.
- Unknown required native capabilities block editing.
- Render imported metadata as text, never HTML.
- Apply STEP entity, count, depth, and time limits where the adapter allows.
- Checksum large embedded sources.
- Parser failure never modifies the current document.

## File writes

- Write only after an explicit user action and permission.
- Save As never overwrites an import source by default.
- Stage, checksum, and close before publishing a file.
- A browser handle may expire; always retain download fallback.
- Distinguish internal autosave from user-visible file save.
- Destructive deletion requires an exact target and recoverable trash/undo policy where practical.

## Supply chain

- Exact dependency versions and committed lockfile.
- Dependency review for WASM and native artifacts.
- SBOM in releases.
- Checksums and provenance for prebuilt WASM.
- Prefer reproducible custom OCCT and solver builds.
- Archive sources and build instructions required by LGPL/GPL.
- Renovate or Dependabot may create PRs, but geometry and WASM dependencies never auto-merge.
- Sign releases when the hosting pipeline supports it.

## Service worker

- Cache only versioned assets.
- Never substitute network responses for project data.
- Do not activate an update during a committed transaction.
- Delete old caches only after successful activation.
- Export recovery before schema migration.
- Test cache poisoning and rollback behavior.

## Future cloud or sync

Introducing synchronization requires a separate threat model:

- explicit opt-in;
- preferably end-to-end encryption;
- authentication tokens separated from document content;
- defined conflict semantics, audit, deletion, and export;
- no change to local source-of-truth semantics without an ADR;
- GDPR and regional obligations considered only when a real service and personal data exist.

## Vulnerability reporting

Before a public release, `SECURITY.md` must define a private reporting channel and supported-version policy. Public issues are not the default channel for undisclosed vulnerabilities.
