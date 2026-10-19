# ADR-0116: Connected Assistant Model Authority and Internal Checkpoints

- Status: Accepted
- Date: 2026-10-19
- Partially supersedes: [ADR-0115](0115-automatic-native-project-mcp-access.md) and
  [ADR-0111](0111-native-project-assistant-and-handoffs.md) for built-in chat model-write approval

## Context

A person connecting VibeShape's built-in assistant expects it to work directly in the current
project. Additional per-stage Apply prompts interrupt incremental construction. The person also
needs to compare the previous model and undo an assistant turn without adding artificial features
to parametric History or manually reversing many saved operations.

## Decision

The built-in native ACP and browser API chats select a trusted connected-assistant policy in their
captured document runtime. Connecting authorizes validated model changes in that project through
the existing review ports and revision-checked commits. This covers shipped model, organization,
import and assembly operations; it grants neither project management nor unrelated OS capabilities.
Publishing or updating the reusable local library remains separately reviewed.
Tool arguments cannot select this policy. External local and remote MCP clients retain their
existing pairing and approval contracts.

Exact preview, whole-transaction validation, captured project/actor ownership, cancellation, lease,
revision and persistence checks remain mandatory. Valid stages appear in the owning viewport and
save incrementally. Private previews remain unsaved. Stop AI revokes tool authority and prevents
silent reconnection; an already accepted persistence operation may finish. Recovery never replays
an uncertain write.

The existing document Undo/Redo owner captures an opaque internal checkpoint before each assistant
turn, including queued and steered requests. Only verified writes by that turn's captured actor may
advance its target. Intervening human or foreign writes invalidate it. Saved changes remain undoable
after a failed or canceled turn when their lineage is still valid. No-change turns add no target.
The handles are bounded runtime state, not new document records or authored History items.
Capture requires a readable baseline/head pair within that bound. An owning assistant save that
would exceed the checkpoint budget is rejected before publication, preserving the last saved
rollback target. Human or foreign edits remain available and invalidate the checkpoint instead.
Turn settlement waits for already accepted document transactions through the session queue before
sealing the target or dispatching another turn; sealed older targets do not constrain new writes.

**Undo agent changes** restores a settled valid turn through one ordinary atomic compensating
transaction and leaves Redo available. It does not loop over public Undo or overwrite later edits.
**View before** rebuilds the captured baseline in an isolated worker and temporarily displays it;
**View current** returns to the saved result. Comparison changes no persisted state or Undo stack.
Project/head checks run before and after the rebuild. Navigation, new work and intervening edits
clear the transient display. Checkpoints are not a durable job store across reloads.

## Verification

Cover built-in automatic commits and unchanged external manual approval, Stop/recovery races,
project isolation, saved series undo/Redo across document versions, checkpoints beyond ordinary
Undo retention, stale/forged handles, failed persistence, rotated/foreign actors, and late writes.
Cover before/current display without persistence or History mutations, baseline visibility and
assembly placement, asynchronous invalidation, and accessible pending/disabled controls. Preserve
geometry validation and revision-conflict tests.
