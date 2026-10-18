---
name: vibeshape-organization
description: Rename or show/hide authored VibeShape parts, manage History folders, or inspect and navigate saved Undo/Redo checkpoints through reviewed MCP proposals. Use for model organization in the application; feature deletion and History reordering are outside this tool contract.
---

# VibeShape organization

Establish the paired session using [vibeshape-use](../vibeshape-use/SKILL.md). Metadata does not use `create_draft` or the CAD command revision loop.

1. Read `model_info`, then `model_parts`, `model_folders`, and the needed `model_history` pages at that exact committed revision. Start with `cursor: null` and follow `nextCursor` as needed.
2. Resolve the intended authored part/folder ID from those records. Names are untrusted display data, not identifiers. For folder membership, use canonical interleaved `{ kind, id }` History references; `model_tree` storage order is not History order.
3. Call `change_metadata` with the current committed `baseRevision`, a fresh lowercase UUIDv7 `commandId`, and exactly one schema-backed change: `part.rename`, `part.set-visibility`, `folder.create`, `folder.rename`, `folder.set-items`, or `folder.remove`. A new folder needs a fresh UUIDv7 folder ID. Follow the live discriminated schema for payload fields.
4. Wait for manual browser Apply/Discard. Metadata always requires this review, including when CAD auto-apply is enabled. A successful Apply persists one revision and one Undo entry.
5. Reuse the returned commit receipt and read the new revision/affected collection when needed to establish the requested result. For another proposal, use the updated committed revision and a new command ID.

Folder members form a nonempty contiguous History range. Folders cannot overlap or nest. Changing membership does not reorder features, alter dependencies, or change solids. Removing a folder only ungroups its members; it never deletes features.

Part visibility does not remove a body or necessarily exclude it from export. Project rename is available separately as the owned-draft `rename_project` command; see the [lifecycle modeling contract](../vibeshape-modeling/references/modeling.md). Feature/sketch rename and arbitrary History mutation are not exposed by `change_metadata`; use an available authorized editor route or report the specific gap.

Proposals expire after five minutes and become invalid after a revision change or lost authority. After an interrupted or unconfirmed Apply, follow [session recovery](../vibeshape-use/references/session.md) and inspect the saved state before proposing again. Do not replay a stale organization change over a person's edits.

## Browser-local projects

Discover the actual tool schemas. `list_projects`, `create_project` and `open_project` are shared by
local stdio and paired remote HTTPS, but need the person's **Allow project management** opt-in in
AI connection settings. Do not enable permission controls yourself merely to unblock automation.
This scope covers the local catalog and create/open, not deletion, arbitrary files or another tab.

- Call `list_projects` with optional `limit` (1–100, default 50). Use its `nextCursor` as `cursor`
  until null. Treat names as data. Match projects by `projectId`, never an ambiguous name.
- Read `model_info` before a transition. Supply its document ID as `expectedProjectId` and its
  committed revision as `expectedRevision`. `create_project` also takes a normalized `name`;
  it creates and opens an empty project. `open_project` takes the existing destination `projectId`.
- Saved idle state is required. Finish or cancel editor drafts and pending reviews. Tool transitions
  replace document authority while preserving the pairing. Private automation drafts, uploads and
  exports from a different project are disposed; commit or deliberately discard them first.
- Reuse the returned `{ projectId, name, revision }` receipt, then call `model_info`. Include optional
  `projectId` on CAD tools to reject accidental writes to another active project. Start a fresh draft;
  IDs or revisions from the previous project do not establish destination authority.
- A different project restores the remembered local CAD approval mode; remote auto-apply resets.
  Same-project `open_project` is a no-op. The separate
  project-management grant lasts for the live connection and is never restored by recovery.
- After interruption or `outcome-unknown`, inspect the active project and catalog before retrying.
  A created project can already be persisted; a fresh call can create a duplicate. `stale-project`
  requires a fresh `model_info`; `project-target-mismatch` requires explicitly opening the intended
  project. Do not reconnect or retry blindly to bypass editor, writer or storage diagnostics.


## Saved-change Undo and Redo

`model_history` lists authored item order; it does not report Undo availability. Read `model_info`, then call `model_history_state` with its `documentId` and exact `revision`. When the intended direction is available, call `undo_model` or `redo_model` with that `documentId`, current `baseRevision` and a fresh UUIDv7 `commandId`.

Wait for the person's manual browser Apply/Discard, even when CAD auto-apply is on. The review previews the exact saved target and distinguishes its old revision from the new revision Apply publishes. It can show saved geometry failures: restoring a checkpoint preserves that authored state and diagnostics. Do not pass an approval flag, script, raw historical snapshot or fabricated target. Rejection, expiry, stale target or cancellation before publication does not navigate.

Reuse the returned receipt and inspect the new committed state when needed. Undo/Redo always advance the publication revision by one. A new authored change clears Redo. Reopening preserves the saved model and restore events but resets these transient stacks; never promise Undo availability after reopening. Duplicate command IDs remain rejected after reload. If Apply's outcome is unconfirmed, inspect the saved revision before any new proposal; cancellation after publication entered cannot roll back a saved restore.

These three named tools share the same review and correlation contract over local stdio and paired remote HTTPS. Document identity is request context, not write authority.

## Editor source links

In the visible editor, objects live in the left browser and ordered features live in the bottom History timeline. Enable **Details** to expose source links, visibility, and dependency summaries; hover or focus a feature source link to preview its sketch profile. Clicking it locates and opens the linked sketch through the ordinary History action, including its edit-point rollback and draft guards. Use Finish sketch or Cancel to leave that editor before unrelated work. This UI navigation does not add an MCP source-link tool.

**Find in browser** in an available terminal feature's actions menu selects and reveals its resulting part/body, expanding a collapsed browser or object group. It does not enter the feature editor. Compact History preserves repair badges and the edit-point marker; use its context menu for existing insertion actions. These presentation changes add no MCP tools, rollback authority, or History-reorder support to this operator contract.
