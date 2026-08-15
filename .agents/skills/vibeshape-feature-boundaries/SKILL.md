---
name: vibeshape-feature-boundaries
description: Decide where a new VibeShape capability belongs across existing code, first-party feature modules, shared host services, extension seams, and MCP automation adapters. Use before adding a CAD feature, tool, workflow, package, registry contribution, extension capability, worker responsibility, or automation surface, especially when deciding whether to create a module or reuse an existing owner.
---

# VibeShape Feature Boundaries

Choose one authoritative owner before implementation. Modularize around durable CAD capabilities and
invariants, not around every toolbar action or source file.

## Read the Accepted Boundaries

Read the affected architecture document and ADR before deciding. For module, extension, or automation
work, start with:

- `docs/adr/0013-microkernel-modules-and-mcp-automation.md`;
- `docs/architecture/extensions.md`;
- `docs/architecture/automation-and-mcp.md`;
- `docs/architecture/overview.md`.

Do not treat spike packages as production authority or expose the public extension SDK while its
documented release gates remain closed.

## Select the Owner

Choose among these outcomes:

1. **Extend an existing owner** when the capability shares its domain language, invariants, data,
   runtime profile, and lifecycle.
2. **Create a first-party feature module** when it contributes a cohesive CAD capability with its own
   schema-backed parameters, eligibility, preview or evaluation, migrations, and tests.
3. **Extend a host service or core package** when the behavior coordinates document authority,
   commands, persistence, workers, selection, localization, or capability enforcement for multiple
   modules.
4. **Define an extension seam** only when third-party replacement or independent distribution is a
   real requirement. Keep execution behind the accepted capability and sandbox boundary.
5. **Add an MCP or automation adapter** only as a transport over the same registered queries,
   disposable drafts, previews, validation, and revision-safe commands used by the UI.

Prefer an existing owner unless a distinct invariant set, trust boundary, runtime isolation need, or
independent lifecycle provides a strong reason to split.

## Evaluate the Boundary

Record evidence for:

- user-visible capability and domain terms;
- source-of-truth data and invariant owner;
- dependency direction and downstream consumers;
- synchronous, worker, WASM, or asynchronous execution profile;
- security, permission, determinism, and resource limits;
- versioning, migration, failure, disablement, and recovery behavior;
- reuse by UI, first-party modules, extensions, and automation;
- testing and documentation ownership.

Do not create a package merely for cleanliness, a single component, or a single helper. Create one
when it provides an enforceable public boundary with real consumers or isolated runtime ownership.

## Preserve Platform Invariants

- The document command path remains authoritative; modules do not mutate stores directly.
- Preview is disposable. Apply creates one validated command and one undo entry.
- `packages/domain` remains independent of React, Three.js, persistence, and geometry adapters.
- Geometry and solver implementations remain behind workers and typed protocols.
- First-party and extension commands use the shared registry, eligibility, localization, async,
  cancellation, diagnostics, and undo contracts.
- Extensions never receive ambient document, storage, network, file, or raw-kernel authority.
- MCP does not introduce a privileged parallel API or bypass confirmation classes.

## Decision Handoff

Before editing, state:

1. the recommended owner and whether it extends or creates a boundary;
2. the contract it owns and explicitly must not own;
3. dependency direction and registered contribution points;
4. trust, worker, schema, migration, and failure consequences;
5. the smallest vertical slice and required tests;
6. whether an ADR or durable documentation update is required.

Use `vibeshape-documentation-sync` when the accepted architecture or public package boundary changes.
