# ADR-0135: CAD Execution Without Default Deadlines

- Status: Accepted
- Date: 2026-10-27
- Numerical-call waiting policy superseded by [ADR-0137](0137-browser-owned-numerical-jobs.md)
- Partially supersedes execution deadlines in [ADR-0043](0043-local-stdio-mcp-browser-session.md), [ADR-0058](0058-remote-mcp-paired-browser-transport.md) and [ADR-0134](0134-local-geometry-resource-policy.md)

## Decision

Remove automatic local and remote MCP operation deadlines for all CAD tools. Document and geometry
worker requests, browser document-worker startup, native project import/duplication and native
backup likewise wait for completion, explicit cancellation, termination or a reported failure.
Low-level worker callers can still explicitly request a deadline; ordinary production callers do
not receive one implicitly.

Jev's language-provider timeout must not abort its CAD calls. Pass the original Stop signal to
tools. Its pinned MCP SDK always installs a finite outgoing request timer, so allow at least
600,000 milliseconds for ordinary tools, preserving longer requested waits and the existing
manual-review horizon. Do not simulate unlimited SDK waits with overflowing timer values.

Session authentication, heartbeat loss, upload admission, proposal expiry, provider requests and
bounded shutdown remain separate contracts. Removing an execution timer grants no additional
authority and does not make an unconfirmed write safe to replay.

## Client Boundary and Recovery

The server cannot override an external client's tools/call timeout. Configure that client without
an execution deadline where supported, or with at least ten minutes. A received MCP cancellation
or transport closure interrupts the pending operation. The native HTTP host closes its attachment
when an unfinished POST response stream closes, even without a cancellation notification.
Local authenticated recovery then allows a fresh read without replaying old work. If a client abandons its request without cancellation or
disconnecting, the server cannot infer that abandonment from continuing browser heartbeats; its
operation can remain pending and later serialized reads return `busy`. Stop AI explicitly cancels
it before reconnection and revision inspection.

## Evidence and Consequences

Virtual-time regressions complete requests beyond ten minutes, retain explicit cancellation and
worker-failure cleanup, and verify actual MCP SDK timeout notification releases a Quick operation
for authenticated recovery and a fresh read. A native HTTP regression aborts a live Quick POST
without an MCP cancellation notification and verifies attachment release and reconnection; it fails
against the previous stream lifecycle. Remote transport tests retain revocation semantics.
These prove lifecycle behavior, not the completion time or feasibility of a particular model.

An operation that never settles now remains pending until cancelled or its owner ends. This is
intentional; failure and Stop paths must release resources without relying on an elapsed timer.
