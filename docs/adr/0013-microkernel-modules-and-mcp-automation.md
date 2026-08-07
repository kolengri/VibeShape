# ADR-0013: Microkernel Modules and MCP Automation

- Status: **Proposed**
- Date: 2026-08-08

## Context

VibeShape should make new modeling, analysis, exchange, and workflow functionality easy to add without turning the application into a tightly coupled collection of switch statements. It should also let AI clients inspect and operate an explicitly shared document through the Model Context Protocol (MCP).

Treating every subsystem as an installable extension would create a circular bootstrap problem. Document transactions, command history, persistence, geometry ownership, extension policy, and recovery must exist before an extension can be loaded safely. Conversely, implementing every built-in feature through private application APIs would make the eventual public extension contract second-class and would create a separate automation path for MCP.

MCP tools are model-controlled protocol operations. They must not receive direct access to React state, browser storage, OCCT objects, internal extension hosts, or mutable document structures. Tool metadata and client confirmation are useful signals, but VibeShape must enforce its own authorization, validation, preview, and commit rules.

## Decision

Adopt a microkernel architecture with four rings:

1. **Trusted kernel services** own document identity, revisions, transactions, command dispatch, undo/redo, feature-DAG scheduling, persistence and migrations, geometry and solver ports, capability policy, recovery, and audit provenance. These services are not extensions.
2. **First-party feature modules** contribute modeling features, commands, analyses, codecs, property schemas, and UI metadata through explicit registries. They are bundled and reviewed with the application, may use trusted execution containers where performance requires it, and do not require installation or permission prompts.
3. **Third-party extensions** use the compatible public subset of the same contribution contracts but run through the isolation, package, version-lock, capability, and resource rules defined by [ADR-0012](0012-capability-based-extension-platform.md). Contract parity does not imply equal trust or equal runtime placement.
4. **External adapters**, beginning with MCP, translate external protocols into the same serializable query and command contracts. They never become an alternative domain mutation API.

Built-in modularity is defined by cohesive ownership and replaceable contracts, not by creating one workspace or one `.vsext` artifact per toolbar action. A first-party module may contribute a related feature family such as sketching, part design, exchange, or print analysis. Module dependencies form an explicit acyclic graph and activation cannot change document semantics.

The initial MCP integration is a local Bun bridge using MCP `stdio` for compatible local clients. In automation mode, the bridge serves the reviewed static VibeShape build from a stable loopback origin and the user explicitly enables one browser session and selected documents. This avoids making cross-origin private-network access a foundation assumption while keeping the browser document authoritative. Connecting an independently hosted PWA, Streamable HTTP, remote clients, and headless document ownership are later capabilities with separate browser, authorization, and deployment gates.

MCP exposure follows these rules:

- resources expose bounded, serializable, revision-tagged document views;
- tools are generated only from commands explicitly marked automation-safe by the host;
- write tools operate on a disposable draft, not the committed document;
- draft commit requires a matching base revision and host-owned user confirmation unless an explicit future policy grants bounded unattended operation;
- progress and cancellation map to the normal command and worker lifecycle;
- structured tool output uses the same diagnostics and stable identifiers as the application;
- extension-contributed commands are not exposed automatically merely because an extension requests it;
- every committed automation command records MCP session and tool provenance in the normal command log.

The target design is defined in [Automation and MCP architecture](../architecture/automation-and-mcp.md). No MCP SDK dependency or empty server workspace is added until the command and snapshot contracts can support one executable vertical-slice tool.

## Consequences

- Most product functionality becomes modular without making application boot, save, recovery, or security dependent on extension loading.
- Built-in and third-party features can converge on common deterministic feature and contribution contracts while retaining different trust and deployment paths.
- The command registry becomes the single mutation surface for UI, extensions, tests, macros, and MCP.
- Commands need machine-readable input and output schemas, eligibility, side-effect annotations, preview behavior, revision preconditions, cancellation, and stable diagnostics.
- Read models need bounded snapshot schemas that do not expose internal object graphs or derived data as semantic truth.
- The local MCP bridge introduces pairing, session revocation, origin validation, resource limits, and audit requirements even though it does not own project files.
- Headless automation is not implied by the local bridge. It requires a separate host for persistence, geometry workers, confirmation policy, and recovery.
- The repository avoids a package-per-feature explosion. A new workspace is justified by a real execution, dependency, ownership, or publication boundary.

## Rejected alternatives

### Make every kernel service an extension

An extension runtime cannot safely own the transaction, persistence, geometry, capability, and recovery services needed to validate and contain that same runtime. It would also make a missing or disabled package capable of preventing basic document recovery.

### Give built-in modules private mutation APIs

Private mutations would make public extensions and MCP second-class, bypass command invariants, and multiply undo, validation, and persistence paths.

### Run every first-party module in the third-party sandbox

This would impose startup, serialization, debugging, and resource costs where the code is already shipped and reviewed with the application. First-party code still uses bounded contracts, but runtime isolation is selected according to risk and performance.

### Expose one generic `execute` or `run_script` MCP tool

An unbounded interpreter is difficult to validate, authorize, preview, make idempotent, or represent in undo history. Explicit schema-backed commands are more discoverable and preserve domain invariants.

### Let the MCP process edit `.vshape` or browser storage directly

Two authorities could race, bypass migrations, disagree about revisions, or lose recovery metadata. The paired application session remains the only writer in the initial integration.

### Expose every registered extension command through MCP

Extension metadata is not a security grant. Automation exposure requires host policy, a safe schema, bounded outputs, side-effect classification, and an enabled extension with sufficient user-approved capabilities.
