# ADR-0099: Complete session CAD auto-apply and live local commits

- Status: Accepted
- Date: 2026-10-05
- Supersedes: CAD eligibility restrictions in [ADR-0052](0052-session-cad-auto-apply.md), lifecycle review restrictions in [ADR-0088](0088-named-primitive-and-lifecycle-mcp-commands.md), extrusion v7 exclusion in [ADR-0094](0094-finite-curved-face-extrusion.md), and the local commit execution deadline in [ADR-0095](0095-local-mcp-continuous-recovery.md)
- Preserves: browser-owned consent and revocation, separate service authority, and [ADR-0098](0098-cad-review-without-deadline.md)

## Decision

An explicit browser-owned CAD auto-apply grant covers supported first-party CAD draft changes for
the exact paired MCP actor and document. The grant includes feature creation and update, supported
same-type schema upgrades, suppression and removal; sketch creation, update and removal; and variable
creation, expression changes, rename, removal and table replacement. A coherent replacement such as
removing Shell, adding Mirror and authoring Extrusion v6 does not require repeated browser approval.
Manual review remains the default, and no MCP tool enables or changes this grant.

Feature eligibility comes from the shipped Part Design and Reference Geometry descriptors, using
their exact module ID, module version, type ID and schema version. This includes all currently
supported versions, including Extrusion v6/v7. Native and mesh import features remain excluded,
including their lifecycle targets. Unknown types, extensions, unsupported future versions and
commands outside the explicit CAD command scope fail closed to manual review. Feature updates
retain their type identity; both prior and incoming versions must be supported. Sequential commands
are checked against a detached working feature collection, including removals and suppression.

Document metadata, project-management services, exports, imports, assembly/library services,
saved-change History and surface-texture proposals retain their existing separate authority and
manual-review contracts. The CAD grant does not add access, filesystem, printing or service authority.

Auto-apply changes only the browser review decision. The host still requires successful semantic
and exact geometry preflight, whole-draft actor/document ownership, an unchanged base revision,
live authorization and post-review revalidation. Invalid geometry cannot commit. Opt-in is idle-only
and captured at commit invocation; a pending manual review cannot acquire a later grant. Stop AI,
revocation, document change and session disposal still prevent an unaccepted write. Accepted
persistence reports its actual result and creates one ordinary Undo entry.

## Local commit lifetime

The local broker does not impose an absolute six-minute operation deadline on `commit_draft`.
Browser review may exceed that wall-clock interval while the approved browser remains live.
Before review opens, the owned draft still has its ordinary five-minute idle expiry, including
validation and exact geometry work; removing the broker deadline does not suspend that expiry.
Heartbeat loss, cancellation, revocation, credential and approval expiry still settle
the operation under the existing lifecycle rules. Other local operations retain their bounded
execution deadline; separate review services retain their own expiry. Client timeouts remain
independent and an uncertain outcome requires inspecting saved state before retrying.

## Verification

Policy tests cover supported feature versions, lifecycle sequences, schema upgrades, invalid geometry,
actor/document drift, unsupported versions, extension/import targets and mixed metadata drafts.
Session journeys cover exact CAD commits without a review, manual opt-out, stale revisions, Stop,
project replacement, recovery and saved Undo/Redo. Broker tests cover a live commit beyond six minutes,
ordinary-operation timeout, stale browser polling and explicit revocation without replay.
