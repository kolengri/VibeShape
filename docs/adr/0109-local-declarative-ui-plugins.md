# ADR-0109: Local declarative UI plugins

- Status: **Accepted with reduced scope**
- Date: 2026-10-18
- Related: [ADR-0012](0012-capability-based-extension-platform.md)

## Context

The editor needs an installable extension workflow before a deterministic modeling ABI and arbitrary
executable package runtime are ready. Promoting the private extension sandbox spike would prematurely
promise executable compatibility and leave its production isolation gates unresolved.

## Decision

Support an experimental, data-only workspace profile in `.vsui.json` files. A package declares bounded
commands and calculator panels, numeric inputs and linear output expressions. It cannot contain HTML,
JavaScript, WebAssembly, URLs or host command requests. The only capabilities are `ui.command` and
`ui.panel`; installation explicitly reviews both.

The browser validates strict schemas and UTF-8 before installation, pins the original bytes by SHA-256,
and rejects conflicting content under an installed ID/version. Installation and enablement live in a
bounded browser-local store, independently of project files. Native Web Locks serialize all store
mutations across tabs; missing locking denies writes while retaining read access. Reload retains permissions but opens no
panel. Disable, removal and cross-tab revocation dispose active panels.

A host-owned classic script renders package data in an opaque `allow-scripts` iframe. Its CSP permits
only that trusted script and forbids network, forms, nested frames and other resources. The public
renderer asset alone permits anonymous CORS for the opaque frame; other resources retain the existing
same-origin policy. The remote editor frame policy permits local panels alongside its existing
Turnstile origin. A dedicated
MessagePort validates session identity, nonce, sequence, size and lifecycle. The frame receives only
panel declarations and localized panel copy. Projects, application stores, geometry, credentials and
MCP authority never enter the protocol.

This supplements the reduced scope of ADR-0012. Arbitrary executable third-party packages, parametric
features, codecs, a stable public SDK and package catalogs retain their existing production gates.
The private `@vibeshape/extension-spike` remains evidence rather than a product dependency.

## Consequences

- Users can install and invoke useful local calculator plugins without granting project access.
- Plugin calculations are independent of document units and model state; package labels declare units.
- Resource bounds follow the finite declarative schema rather than a promise to cap arbitrary code.
- Packages are not signed publisher identities; the displayed integrity pins exact installed content.
- Updating an existing ID/version requires removal or a distinct version. There is no automatic update.
- Experimental schema v1 is deliberately smaller than the future `.vsext` contract.
- Verification includes malformed packages, integrity, persistence failure, revocation, message replay,
  teardown and an actual iframe workflow under the deployed CSP.

See [UI plugins](../product/ui-plugins.md) for the supported user workflow and bounds.
