# ADR-0146: Isolated TypeScript design recipes and identity-based macros

- Status: Accepted
- Date: 2026-11-01
- Related: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md), [SPK-006](../spikes/spk-006-extension-sandbox.md)

## Decision

The application owns a versioned, schema-validated `vibeshape.recipe` v1 interchange contract in
`@vibeshape/application/design-recipes`. It contains typed document variables, sketches, registered
feature declarations, display units and interleaved modeling History. The editor exports these
declarations as TypeScript with `export default recipe`. Users may construct the data with typed
loops and `Math`; a shipped three-sphere example demonstrates the complete path.

Sucrase removes TypeScript syntax inside a disposable module worker. The resulting JavaScript
runs only in the QuickJS WebAssembly interpreter. No host functions or document, browser, network,
storage or file bindings enter the interpreter. Clock and randomness are unavailable. The worker
is a termination and responsiveness container; QuickJS's separate interpreter is the authority
boundary. This does not change SPK-006's rejection of arbitrary same-origin JavaScript workers.

Each run accepts at most 2 MiB source, uses a 16 MiB interpreter memory limit and 512 KiB stack,
and has a one-second interpreter deadline. The browser terminates the entire worker after twenty
seconds including loading/transpilation, cancellation, invalid output or completion. Interpreter
memory limits cover QuickJS allocations, not the compiler or browser worker's entire process.
Only JSON recipe output crosses back. Imports have no module loader or `require` binding.

## Replay and recording

Replay validates the registered parameter schemas, canonical semantic inputs and complete model
dependency graph. It remaps all UUID identities, including identities embedded in compound body
roles, and renames conflicting variables while rewriting exact `#name` expression references.
It appends independent copies; it does not borrow destination sketches or bodies. Destination
display units remain a local presentation choice. A recipe is limited to 254 variables and History
items so the existing authored transaction limit remains authoritative.

The editor rebuilds a disposable combined model before enabling Apply. Apply checks the document
identity and revision again, then submits one ordinary authored transaction. Existing persistence,
write access, active edit exclusion and one-step Undo remain authoritative. Failed script execution,
invalid declarations, failed geometry, stale preview and cancellation publish no changes.

Recording stores the document identity and a set of existing History identities. Stop selects new
identities, independent of History insertion position or array length, and copies their dependency
closure and document variables. Existing-item edits are not recorded. Deleted new items do not
appear in the result. A document switch or a recording with no surviving new items fails explicitly.

## Preservation and availability

Whole-design export refuses source assets/imports, topology-bound references, model-supported
sketches, assemblies, surface textures, custom authored part naming/visibility, organizational
folders, appearances and retained repair History. These require native `.vshape` preservation.
The exporter never reports complete preservation after dropping unsupported content.

`export_design_recipe` is a read-only, exact-revision local and paired remote MCP tool. It returns
at most 128 KiB TypeScript source with document/revision context checked by both transports. Larger
exports use the editor download. MCP does not execute or apply arbitrary script source.

Script source and recording state are session-only and downloadable. Applying expands the result
into ordinary editable features. Saved models do not retain an associative Script feature or rerun
source on variable edits, reopening, import or rebuild. Persistent procedural Script features would
require a separate versioned feature/rebuild contract and are outside this decision.

## Alternatives

Executing source with browser `eval`, `Function` or a same-origin JavaScript worker would expose
ambient browser authority and is rejected. A full browser TypeScript compiler adds substantial
runtime weight; Sucrase performs only syntax transformation and QuickJS owns execution. Native
TypeScript 7 remains the repository checker and is not a browser transpiler API. QuickJS core plus
the synchronous release variant avoids bundling unused async/debug interpreters. The existing
build notice scanner retains Sucrase and QuickJS/embedded-engine MIT notices.
