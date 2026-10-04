# ADR-0088: Named Primitive and Lifecycle MCP Commands

- Status: Accepted
- Date: 2026-10-04
- Related: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md)

## Decision

Expose the existing registered Box update and Cylinder, Cone, Sphere, Torus and Pyramid
create/update commands through additive named MCP tools. Reuse each exact domain parameter
schema, including authored quantities, placement, centered behavior and dimensional bounds.
Independent primitive inputs accept no dependency or topology arrays. Legacy `create_box`
retains its numeric millimeter shorthand. No Wedge type exists in the current feature registry;
the MCP catalog does not create an alias or a new kernel primitive.

Expose four existing lifecycle commands: `remove_feature`, `remove_sketch`,
`set_feature_suppressed` and `rename_project`. Their adapters only construct the registered
feature removal, sketch removal, explicit suppression and document rename command envelopes.
The paired host supplies the document and actor; inputs retain ordinary current-revision and
fresh-command-ID preconditions. No generic execution, History navigation, cascading deletion,
or model-reference-intent override is introduced.

Dependency-blocked removals retain domain diagnostic codes and do not change draft state.
Suppression preserves authored records and can make dependent geometry unavailable; exact
preview must report and repair that state before commit. Rename requires a normalized nonempty
name no longer than 120 characters and preserves geometry and entity identity.

All lifecycle commits require manual browser Apply/Discard even under a CAD auto-apply grant.
Existing primitive family/version eligibility remains unchanged. Removals advertise destructive
tool annotations and retain the existing destructive command policy. Accepted draft transactions
persist through the ordinary event/replay path and create one ordinary Undo entry.

## Consequences

Local and paired remote transports share the same schema catalog and adapters. Operator skills
and their generated bundle describe the complete typed update and dependency-repair workflows.
No feature-schema, worker-protocol, native-geometry or storage migration is needed.

Verification includes public schema rejection, MCP discovery/client validation, owned command
envelopes, denial under CAD auto-apply, dependency diagnostics, exact event replay, real OCCT
primitive measurements, browser review, Undo/Redo and reload. Existing native primitive behavior
remains the computational authority.
