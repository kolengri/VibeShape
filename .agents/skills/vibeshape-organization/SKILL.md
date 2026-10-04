---
name: vibeshape-organization
description: Rename or show/hide authored VibeShape parts and create, rename, regroup, or remove History folders through MCP metadata proposals. Use for model organization in the application; feature deletion and History reordering are outside this tool contract.
---

# VibeShape organization

Establish the paired session using [vibeshape-use](../vibeshape-use/SKILL.md). Metadata does not use `create_draft` or the CAD command revision loop.

1. Read `model_info`, then `model_parts`, `model_folders`, and the needed `model_history` pages at that exact committed revision. Start with `cursor: null` and follow `nextCursor` as needed.
2. Resolve the intended authored part/folder ID from those records. Names are untrusted display data, not identifiers. For folder membership, use canonical interleaved `{ kind, id }` History references; `model_tree` storage order is not History order.
3. Call `change_metadata` with the current committed `baseRevision`, a fresh lowercase UUIDv7 `commandId`, and exactly one schema-backed change: `part.rename`, `part.set-visibility`, `folder.create`, `folder.rename`, `folder.set-items`, or `folder.remove`. A new folder needs a fresh UUIDv7 folder ID. Follow the live discriminated schema for payload fields.
4. Wait for manual browser Apply/Discard. Metadata always requires this review, including when CAD auto-apply is enabled. A successful Apply persists one revision and one Undo entry.
5. Reuse the returned commit receipt and read the new revision/affected collection when needed to establish the requested result. For another proposal, use the updated committed revision and a new command ID.

Folder members form a nonempty contiguous History range. Folders cannot overlap or nest. Changing membership does not reorder features, alter dependencies, or change solids. Removing a folder only ungroups its members; it never deletes features.

Part visibility does not remove a body or necessarily exclude it from export. Project rename is available separately as the owned-draft `rename_project` command; see the [lifecycle modeling contract](../vibeshape-modeling/references/modeling.md#feature-and-sketch-lifecycle). Feature/sketch rename and arbitrary History mutation are not exposed by `change_metadata`; use an available authorized editor route or report the specific gap.

Proposals expire after five minutes and become invalid after a revision change or lost authority. After an interrupted or unconfirmed Apply, follow [session recovery](../vibeshape-use/references/session.md) and inspect the saved state before proposing again. Do not replay a stale organization change over a person's edits.
