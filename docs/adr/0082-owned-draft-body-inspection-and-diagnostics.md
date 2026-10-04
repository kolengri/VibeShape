# ADR-0082: Paged feature measurements and serialized local acknowledgements

- Status: Accepted
- Date: 2026-10-04

## Context

Exact draft preview returns a bounded first page of terminal feature measurements. A blocked
terminal output can hide the upstream failure, and committed body inspection cannot select
geometry authored only in a draft. ADR-0077 already provides exact draft body inspection; this
decision extends its shared vocabulary with paged feature measurements.

## Decision

Expose named `model_measurements` and `draft_measurements` alongside existing
`draft_body_measurements` and `draft_body_topology` through the shared local and paired remote
vocabulary. Feature
measurements retain terminal scope by default and accept explicit `scope: "all"` for diagnostics.
Use existing registered measurement and topology queries; do not add raw geometry access.

Draft geometry inspection rebuilds an isolated snapshot, projects bounded serializable evidence,
and terminates the worker before returning. The host retains at most one detached catalog with a
4 MiB serialized limit. Its identity includes draft ID and revision, plus exact target/body/kind
for topology. Commands, discard, commit, or another geometry inspection can invalidate paging.
Cold or evicted cursors fail and require restarting from a null cursor.

Ownership, committed base revision, expiry, document, requested target, and response revision
remain validated before and after asynchronous geometry work. Inspection never renews expiry,
authorizes auto-apply, mutates the committed project, or retains native handles or meshes.

The local HTTP connection may receive the next request while the previous result POST awaits its
acknowledgement. Retain at most one next request only during that acknowledgement phase and
start it after a successful acknowledgement. Failed acknowledgement, disable, disposal, duplicate
request IDs, or overflow revoke the pairing and discard queued work. Requests during execution
remain rejected.

## Consequences

Agents can inspect bodies and durable topology before one final browser Apply, and page all
evaluation diagnostics without changing preview's compatibility contract. Large catalogs fail
closed; a target-specific query or smaller document is required. This decision does not expose
solved sketch constraints, profile discovery, file import, or export lifecycle capabilities.
