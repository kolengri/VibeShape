# Draft transactions

## Revision discipline

1. Read `model_info` and relevant complete committed records at its `summary.revision`. Keep this committed base separate from the draft's changing revision.
2. Call `create_draft` with `{ "baseRevision": committedRevision }`. Retain the returned host-generated `draftId` and draft `revision`.
3. Issue supported named commands sequentially. For each command, supply the current **draft** revision as `baseRevision`, a fresh lowercase UUIDv7 `commandId`, and the returned draft ID. Advance only to the revision in a successful result.
4. Updates replace authored records. Read `draft_entity` at the current draft revision, or the original `model_entity` before drafting. Preserve existing IDs and every unaffected parameter, placement, dependency, reference, label, expression, constraint, and suppression value.
5. Call `preview_draft` with `{ "draftId": draftId }`. It first simulates retained commands through the current document authority, including ordered History and authored Part rules, without writing storage or opening review. A failed preflight identifies the command index, ID, kind and cause; repair that intent before proceeding. Features cannot depend on an item later in History, even when the disposable geometry graph can evaluate them. Then check exact `geometry.status`, `geometry.diagnostics`, bounds, and volume against the requested design. Valid solids do not establish healthy sketch support or external references. Fix invalid intent through a supported update with a new command ID; inspect the updated draft revision before continuing.
6. Call `commit_draft` with `{ "draftId": draftId }`. It repeats document-authority validation before exact geometry and review. External clients default to browser Apply/Discard; an existing explicit session auto-apply grant applies supported first-party CAD changes, including lifecycle removal and suppression, without repeated confirmation. The built-in native and browser API chats use connected model authority and commit valid stages without a second Apply action; see [session policy](session.md). Local commits have no absolute broker wall-clock deadline while the authorized browser remains live; cancellation, revocation, heartbeat loss and credential/approval expiry still apply. Successful preflight cannot guarantee disk quota, writer access or an unchanged revision at the eventual write. A successful commit saves once and creates one Undo entry. Verify the returned result and observe the saved revision with `model_info`.

Build usable stages rather than accumulating the entire model in one private draft. Draft results
advertise `commandBudget.limit` and `remaining`; the normal limit is 64 commands, including updates
and corrections. Leave capacity to repair geometry, validate and commit each coherent stage, then
start the next draft at the actual saved revision. Existing saved features remain in the project.
Do not discard a saved stage or reconstruct it just to obtain a new draft budget.

Successful browser draft commands also request an exact disposable viewport preview. Valid geometry
is visible before review and remains unsaved; incomplete or invalid intermediate geometry may have
no preview. Explicit `preview_draft` still supplies the authoritative validation diagnostics. A
visible preview does not advance the saved revision, create Undo or grant Apply permission. Later
commands replace it, and cancellation, discard, disposal or a changed committed base removes it.

The person can use **Apply changes** in chat for the exact valid retained preview before the client
next calls `commit_draft`. This uses the same session authority, approval policy and ordinary atomic
commit; the preview remains unsaved until that commit succeeds. If the draft was consumed or the
committed base changed, reread `model_info` and the affected intent before continuing. Do not blindly
replay the old draft or assume that its ID still identifies pending work.

An open CAD draft review has no time limit. Its draft's `expiresAt` describes idle expiry, not an
Apply deadline: the host retains it while review is pending and rechecks access and the committed
base before saving. Cancellation, disconnection and revision changes can still invalidate review.
Unsubmitted idle drafts and separate import, assembly, metadata, history and texture proposals retain their
advertised expiry. An MCP client's request timeout can cancel review; do not automatically replay
an unconfirmed commit. Inspect the saved revision before requesting fresh review.

`draft_tree`, `draft_entity`, and `draft_variables` read semantic intent without rebuilding. Uncached `draft_edges`, `draft_body_measurements`, and `draft_body_topology` reads may perform a disposable exact geometry rebuild. Body inspection uses the current owned draft revision and returns exact roles or scoped faces/edges; Shell can consume its fresh opening references and source content hash before a save. None of these inspection reads renews draft expiry. Use `preview_draft` to validate the entire draft and obtain its exact measurements. An uncommitted draft cannot be exported by `export_model`.

## Conflict and interruption

A rejected authority preflight leaves the draft available for inspection. Its retained command
sequence is immutable: a later update cannot erase an earlier command rejected by History rules.
For an ordering failure, inspect the identified command, discard the private draft and create a
fresh draft with dependencies inserted before consumers. Do not retry commit unchanged.

If the committed model changes while drafting, read the updated model and create a new draft, retaining the person's changes. Do not replay a stale full record. Use `discard_draft` to abandon private intent; it does not alter the saved model. MCP cancellation interrupts disposable work and cannot undo a transaction already accepted by persistence. Local pairing can recover automatically without replaying that work; remote access retains its existing revocation rules.

After a timeout or unconfirmed commit, re-pair if needed and inspect the saved revision and affected IDs/parameters before retrying. Do not treat a reused command ID as an idempotency key. For committed Undo/Redo, follow the [saved-change History workflow](../../vibeshape-organization/SKILL.md), using its document/revision-bound tools and the connection's approval policy.

## Quantity and ID contract

Sketch coordinates and named `*Mm` fields are millimetres regardless of display units. Typed length quantities use canonical mm; angles use canonical radians. Preserve authored source units and expressions:

```json
{
  "schemaVersion": 0,
  "dimension": "length",
  "value": 25.4,
  "unit": "mm",
  "source": { "value": 1, "unit": "in", "expression": null }
}
```

For a variable-driven length, use a matching numeric source and an expression such as `#thickness`; the ordinary evaluator resolves the expression. Measurements declare mm, mm2, and mm3. Never pass a string where the schema requires a typed quantity.

New command, feature, sketch, entity, constraint, variable, and folder IDs are lowercase UUIDv7. Preserve IDs on updates. `crypto.randomUUID()` generates UUIDv4 and is unsuitable. Use a UUIDv7 library already available in the client, or this portable generator in a client-side JavaScript runtime with Web Crypto; it is not a VibeShape tool:

```js
function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index--) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```
