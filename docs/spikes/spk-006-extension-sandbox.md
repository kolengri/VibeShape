# SPK-006: Extension sandbox and package model

- Date: 2026-08-08
- Decision: **Proceed with reduced scope**
- Evidence command: `bun run extension:evidence`
- Public extension API: **Not released**

## Outcome

VibeShape can proceed with the immutable package, exact-integrity lock, deny-by-default capability, restricted-mode, opaque-origin panel, and narrow WebAssembly feature boundaries. The spike does **not** justify executing arbitrary third-party JavaScript in a same-origin workspace worker.

The accepted executable candidate is deliberately small: a feature module is a WebAssembly module with no imports and exactly one scalar `evaluate` export. A production modeling API, document integration, portable hard memory limit, migration protocol, catalog, and public SDK remain release gates. The private `@vibeshape/extension-spike` package is evidence code, not a compatibility promise.

## Runtime comparison

| Candidate | Observed authority | Containment | Decision |
|---|---|---|---|
| Dedicated JavaScript module worker | Network, clock, randomness, IndexedDB, and Cache Storage are available in Chromium, Firefox, and WebKit; DOM and raw OCCT are absent | Infinite loops and floods are terminable, but ambient same-origin browser APIs remain | Reject for arbitrary untrusted workspace code |
| No-import WebAssembly in a dedicated worker | Only scalar input and output; undeclared imports are rejected before instantiation | Infinite loops, message floods, oversized output, and the memory-growth fixture are terminated by the host | Accept as the reduced-scope feature candidate |
| Opaque-origin iframe with `allow-scripts` only | No same-origin privilege; host access exists only through a transferred `MessagePort` | Strict CSP, schema, extension ID, session nonce, sequence, size, and capability checks | Accept as the UI isolation seam |

A Web Worker is retained as a responsiveness and termination container. It is not treated as a security boundary for arbitrary same-origin JavaScript.

## Implemented evidence boundary

The spike implements:

- strict Zod schemas for manifest v1, API versions, capabilities, locks, signatures, panel messages, runtime messages, and failure states;
- a deterministic ZIP fixture and pre-extraction central-directory inspection;
- SHA-256 archive identity and per-file integrity verification;
- ECDSA P-256 publisher signature verification, explicitly separated from sandbox trust;
- immutable package storage with rejection of the same ID and version under different bytes;
- exact ID, version, API version, and integrity resolution;
- major-equal/minor-at-least API compatibility for the candidate protocol;
- deny, grant, capability-expanding update review, revoke, and active-host termination;
- restricted states for missing, disabled, incompatible, timed-out, resource-limited, and failed extensions;
- serialization-preserving retention of an unknown feature payload;
- disposable update invariant comparison and retention of the rollback integrity;
- an opaque-origin iframe panel with a SHA-256 script CSP and a dedicated `MessagePort` handshake.

The package preflight limits are intentionally small spike values:

| Resource | Limit |
|---|---:|
| Compressed archive | 1 MiB |
| Expanded archive | 2 MiB |
| One expanded entry | 512 KiB |
| Entry count | 32 |
| Normalized path length | 160 characters |
| Per-entry compression ratio | 100:1 |
| Worker messages | 16 |
| Worker output | 64 KiB |
| Panel message | 16 KiB |

The archive gate rejects encryption, unsupported compression, comments, truncation, absolute paths, traversal, empty or dot segments, backslashes, NUL bytes, non-NFC names, case-folding collisions, directory entries, Unix symbolic links, undeclared files, missing entry points, missing `LICENSE`, and checksum mismatches before accepting a package.

## Browser evidence

The local Playwright run used one serial test per engine and wrote ignored JSON reports under `.artifacts/extension-spike`.

| Engine | Exact v1 runs | Exact v2 run | Loop timeout | Flood limit | Main-thread ticks |
|---|---:|---:|---:|---:|---:|
| Chromium 151.0.7922.34 | `42`, `42` | `63` | 75.8 ms WASM; 75.5 ms JavaScript | message 17 | 30 |
| Firefox 153.0 | `42`, `42` | `63` | 78 ms WASM; 75 ms JavaScript | message 17 | 22 |
| WebKit 26.5 | `42`, `42` | `63` | 75 ms WASM; 77 ms JavaScript | message 17 | 20 |

All three engines:

- produced equal results for two fresh sessions of the same exact artifact;
- kept both exact package versions available and produced the expected different v2 result;
- rejected the hostile WebAssembly import as `undeclared-import` before execution;
- reported network, clock, randomness, IndexedDB, and Cache Storage as ambient JavaScript-worker authority;
- terminated infinite WebAssembly and JavaScript work without freezing the main page;
- terminated message-flood, memory-growth, and 128 KiB output fixtures at the configured host boundary;
- completed the opaque-origin panel handshake and delivered the declared command;
- revoked `network.connect`, terminated the active host once, and denied later authorization;
- preserved all six restricted-mode outcomes and the unknown payload.

The measured durations are functional evidence, not stable performance budgets.

## Host and package invariants

- A document lock resolves only the exact `id`, `version`, `apiVersion`, and archive `integrity`.
- Two versions may coexist; an update never replaces the old bytes while a document lock needs them.
- Adding `network.connect` requires a new approval and leaves the candidate update disabled.
- A changed deterministic result fails the disposable invariant comparison and retains the prior integrity for rollback.
- A signature answers publisher identity only. Signed and unsigned packages both require identical validation, isolation, and capability enforcement.
- Opening a document never installs, enables, grants, updates, downloads, or executes an extension.

## Known gaps and production gates

The spike does not prove:

- a safe general-purpose JavaScript workspace controller; that candidate is rejected under the current same-origin worker model;
- a high-level deterministic geometry or query import surface for real parametric features;
- a portable hard per-worker memory ceiling. The memory-growth fixture is contained after its message budget, not metered by a browser-independent memory quota;
- integration with the production feature DAG, geometry transaction, undo, persistence, `.vshape`, or topology repair;
- package migrations, catalog transport, trust-store revocation, uninstall preservation, or original-package export;
- localization catalog parity, complete extension-manager UX, keyboard/focus coverage beyond the fixture panel, or command double-activation behavior;
- navigation and download denial under a broader hostile iframe corpus;
- release-grade archive limits, MIME policy, JSON depth limits, SBOM, license compatibility, or signature governance;
- a stable `.vsext` schema, public TypeScript API, CLI, or MCP exposure.

Executable third-party support remains disabled in product code. Before a public SDK, a follow-up production gate must introduce a deterministic modeling import ABI, integrate exact locks and restricted states into real documents, prove no partial commit, establish a defensible memory policy, and run update/rollback and recovery through persistence.

## Reproduction

Install the pinned workspace and run the local-only evidence command:

```bash
bun ci
bun run extension:evidence
```

The runner rejects a truthy `CI` environment, starts a local Vite server, runs the package corpus with Vitest, and runs Chromium, Firefox, and WebKit through `playwright.extension.config.ts`. No GitHub Actions workflow invokes this command.
