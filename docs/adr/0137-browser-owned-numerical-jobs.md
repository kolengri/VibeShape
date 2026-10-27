# ADR-0137: Browser-Owned Numerical Jobs

- Status: Accepted
- Date: 2026-10-27
- Native completion delivery superseded by [ADR-0138](0138-native-numerical-completion-events.md)
- Partially supersedes the numerical-call waiting policy in [ADR-0135](0135-cad-execution-without-default-deadlines.md) and [ADR-0136](0136-native-codex-project-tool-deadline.md)

## Context

Removing application execution timers and increasing a client's deadline to 600 seconds still
leaves long calculations dependent on one finite `tools/call`. A client can abandon that call
without sending cancellation, leaving the serialized broker occupied. The server cannot disable
an external client's timer. Repeatedly increasing it cannot establish deadline-free computation.

## Decision

The existing browser automation session owns numerical jobs. The four structural/Quick analyze
and snapshot-request tools return a schema-validated job receipt immediately. Two ordinary tools,
`get_numerical_job` and `cancel_numerical_job`, read or explicitly interrupt the identified job.
Computation has no execution deadline and uses its own AbortController, independent of the start
request after that request completes. Browser-local and paired remote transports share this owner;
neither broker runs a separate solver or retains a long pending numerical call.

The built-in browser API gateway has no MCP request deadline and retains direct waiting for the
original numerical results, using the existing coordinator path. It does not advertise job controls.
Remove its overall ten-minute assistant-turn timer so it cannot cancel CAD execution; individual
language-provider requests keep their independent request timeout. Stop and disposal still cancel
work. This avoids consuming the browser agent's tool-round budget on numerical status polling.

The existing numerical proposal coordinators continue to own source capture, numerical validation,
review, immutable STL capture and atomic persistence. Their original final result schemas and
settings/source correlation remain authoritative. Job receipts and controls are additional wire
contracts. Completed status carries the original result, including failures, and identifies its
tool, document and captured revision. Original direct results remain accepted for compatibility.

The session runs one numerical job at a time and coalesces an identical active start. Its retained
results have no time expiry and remain actor-bound in session memory until disposal. Session end,
Stop, project replacement and source revision changes cancel active work; no job is replayed after
reload or reconnection. Explicit cancellation reports `cancelling` until the computation/review
settles, preserving the actual outcome of already accepted atomic persistence.

## Alternatives and Consequences

Increasing client deadlines retains the same failure mode. MCP task support requires compatible
clients and cannot be assumed for the installed ACP/Codex client. Ordinary advertised job tools
work through existing clients and browser authority, at the cost of explicit status retrieval.
This changes the four tools' response workflow; operators must distinguish a receipt from final
metrics or a saved snapshot. No public scripting API, solver replacement or durable task queue is
introduced. Authentication, heartbeat, upload/review leases and physical constraints are unchanged.

Tests must cover computation beyond the former deadline, status and unrelated reads while running,
explicit cancellation, owner replacement, stale evidence, result retention, duplicate start and
the real MCP/browser lifecycle. Virtual time and deterministic holds establish lifecycle behavior;
they do not establish the runtime or physical feasibility of the user's model.
