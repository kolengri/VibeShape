# ADR-0012: Capability-Based Extension Platform

- Status: **Proposed**
- Date: 2026-08-07

## Context

VibeShape needs third-party extensibility without weakening deterministic rebuilds, local-first ownership, geometry isolation, or the rule that native project files are not executable. CAD features and general application integrations have different trust and lifecycle requirements and therefore cannot share one unrestricted JavaScript runtime.

The application also needs first-party modularity. Built-in modules should converge on the same contribution and command meanings where practical, but they do not have the same trust, installation, or execution lifecycle as third-party packages. [ADR-0013](0013-microkernel-modules-and-mcp-automation.md) defines that microkernel boundary and the external automation path.

Onshape provides two useful references: deterministic, version-linked FeatureScript custom features and separately hosted OAuth applications embedded in its interface. VibeShape should preserve the former's reproducibility while avoiding a mandatory cloud service and applying a stricter least-privilege model to UI and integration code.

## Decision

Adopt a versioned, capability-based extension platform with three execution profiles:

1. **Parametric feature modules** define deterministic feature types. They receive immutable typed inputs and a host-owned modeling API. They have no network, clock, randomness, DOM, file, clipboard, storage, or direct kernel access.
2. **Workspace extensions** contribute commands, panels, property editors, reports, and analysis views. Their code runs outside the application main realm and communicates only through a versioned, runtime-validated host protocol. Every privileged operation requires a declared and user-granted capability.
3. **Compute and codec modules** may use WebAssembly in a dedicated worker for bounded algorithms or file formats. They receive only declared host imports and never receive OCCT handles. Native or kernel-level modules are not supported by the browser build.

Extension packages are immutable and content-addressed. A document records the exact extension ID, version, API version, and integrity hash required by each custom feature. Updates are explicit and reversible; the runtime never silently substitutes the latest compatible-looking version.

The portable `.vshape` format may record requirements and preserve parameters or cached previews, but it never auto-installs or executes embedded extension code. Missing extensions open in a degraded, non-destructive mode that preserves the original document and identifies the unavailable features.

Executable extension packages remain disabled until a dedicated sandbox spike proves isolation, termination, resource budgets, package validation, permissions, upgrade/rollback, and cross-browser behavior. The first implementation therefore reserves extension metadata and registry seams without publishing an SDK or adding empty workspace packages.

The complete proposed contract is defined in [Extension architecture](../architecture/extensions.md).

## Consequences

- Built-in and third-party parametric features can eventually share a feature contract without sharing trust.
- First-party modules use compatible contribution meanings without requiring `.vsext` installation, third-party permission prompts, or identical runtime placement.
- Rebuild and cache identity include the exact extension artifact, improving reproducibility and offline behavior.
- The application needs an extension registry, package store, permission store, lifecycle host, and stable contribution-point schemas.
- Feature modules cannot call arbitrary JavaScript packages or web APIs; functionality must be exposed deliberately through a versioned host API.
- UI extensions cannot mount React components in the application tree or access application stores directly.
- Networked integrations are workspace extensions, never parametric feature modules, and are optional rather than part of the local-first core.
- Package signing can improve publisher identity, but integrity pinning and sandboxing remain required because signatures do not make code safe.
- Public SDK and marketplace work is deferred until the core command, feature, migration, and sandbox contracts pass their gates.

## Rejected alternatives

### Run arbitrary JavaScript in the main window

This would give extensions ambient access to the DOM, application state, storage, network, and user data. A package bug or compromise could block the interface or bypass capability review.

### Treat a Web Worker as a complete security boundary

A worker protects responsiveness and removes direct DOM access, but same-origin JavaScript still has ambient browser APIs. Workers remain useful execution containers only when combined with a restricted runtime, capability membrane, validation, CSP, and termination policy.

### Embed extension code in `.vshape`

Opening a project would become code execution. It would also make trust, dependency updates, malware scanning, and portable reproducibility harder to explain and enforce.

### Copy Onshape's cloud application model directly

Mandatory hosted OAuth applications conflict with offline use, self-hosting, and local document privacy. Remote services remain possible through explicit network capabilities, but they cannot be the only extension path.

### Publish the TypeScript SDK before the sandbox spike

The SDK would prematurely freeze capabilities, lifecycle, data access, and compatibility promises while the actual browser isolation model remains unproven.
