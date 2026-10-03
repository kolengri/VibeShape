# Draft transactions

## Revision discipline

1. Read `model_info` and relevant complete committed records at its `summary.revision`. Keep this committed base separate from the draft's changing revision.
2. Call `create_draft` with `{ "baseRevision": committedRevision }`. Retain the returned host-generated `draftId` and draft `revision`.
3. Issue supported named commands sequentially. For each command, supply the current **draft** revision as `baseRevision`, a fresh lowercase UUIDv7 `commandId`, and the returned draft ID. Advance only to the revision in a successful result.
4. Updates replace authored records. Read `draft_entity` at the current draft revision, or the original `model_entity` before drafting. Preserve existing IDs and every unaffected parameter, placement, dependency, reference, label, expression, constraint, and suppression value.
5. Call `preview_draft` with `{ "draftId": draftId }`. Check exact `geometry.status`, diagnostics, bounds, and volume against the requested design. Fix invalid intent through a supported update with a new command ID; inspect the updated draft revision before continuing.
6. Call `commit_draft` with `{ "draftId": draftId }`. The default waits for browser Apply/Discard; an existing explicit session auto-apply grant may apply eligible CAD changes. A successful commit saves once and creates one Undo entry. Verify the returned result and observe the saved revision with `model_info`.

`draft_tree`, `draft_entity`, and `draft_variables` read semantic intent without rebuilding. An uncached `draft_edges` read may perform a disposable exact geometry rebuild to resolve selectable edges. None of these inspection reads renews draft expiry. Use `preview_draft` to validate the entire draft and obtain its exact measurements. An uncommitted draft cannot be exported by `export_model`.

## Conflict and interruption

If the committed model changes while drafting, read the updated model and create a new draft, retaining the person's changes. Do not replay a stale full record. Use `discard_draft` to abandon private intent; it does not alter the saved model. MCP cancellation revokes the entire pairing and cannot undo a transaction already accepted by persistence.

After a timeout or unconfirmed commit, re-pair if needed and inspect the saved revision and affected IDs/parameters before retrying. Do not treat a reused command ID as an idempotency key. Ordinary Undo/Redo is a browser operation, not an MCP tool.

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
