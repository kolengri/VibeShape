# ADR-0138: Native Numerical Completion Events

- Status: Accepted
- Date: 2026-10-27
- Partially supersedes native status polling in [ADR-0137](0137-browser-owned-numerical-jobs.md)

## Decision

The browser numerical job owner publishes cached, actor-bound lifecycle snapshots. The native
project connection relays them only from its current authenticated document handle and clears
observers on replacement, credential loss or disposal. The ordinary serialized operation slot
remains free for model reads.

The native chat claims a new running job only while its own model turn is active. It displays
numerical work independently of ACP turn status and preserves Stop, Queue and activity feedback
after the start call returns. Manual review remains available. The initiating checkpoint stays
open until background work settles, preserving accepted snapshot writes and agent Undo.

Completion queues one internal continuation carrying the validated final result, including
physical/runtime failures. Delivery waits for the active model turn, questions, user queue and
checkpoint boundary. Generation and session-token ownership prevent delivery to another chat.
Stop suppresses continuations, and disconnect/disposal drops them. Repeated lifecycle reads do
not send another prompt. Large results use text attachments; clients without that capability
receive a completed-job notice requesting one final retrieval, without status polling.

Native tool instructions tell the model to end its turn after a receipt. External MCP clients keep
their existing status controls; an arbitrary MCP client is not assumed to implement automatic
model wake-up. The browser API gateway still awaits its inline result directly. No execution
deadline, polling timer, provider migration or new model authority is introduced.

## Evidence

Lifecycle and controller regressions cover owner replacement, zero timed polling, fast completion
before turn return, one continuation, Stop/disconnect, final physical failures and checkpoint Undo.
UI tests cover work after ACP idle and manual review availability. Browser evidence exercises a
real numerical worker with a synthetic native bridge rather than making paid provider requests.
