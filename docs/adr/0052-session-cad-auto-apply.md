# ADR-0052: Browser-owned session CAD auto-apply

- Status: Accepted
- CAD eligibility restrictions superseded by [ADR-0099](0099-complete-session-cad-auto-apply.md).
- Local recovery grant reset superseded by [ADR-0095](0095-local-mcp-continuous-recovery.md); remote consent rules are unchanged.
- Local browser preference scope superseded by [ADR-0100](0100-remembered-local-mcp-preferences.md).
- Date: 2026-10-03
- Extends: [ADR-0042](0042-exact-automation-draft-application-path.md), [ADR-0043](0043-local-stdio-mcp-browser-session.md)

## Decision

Keep manual review as the default. A user may explicitly enable auto-apply in the paired browser
for the current document and MCP actor. This in-memory grant is neither a document preference nor
a persistent credential. No MCP tool can enable it. Pairing alone never grants auto-apply.

The captured document automation session owns the review decision. Only an explicit allowlist of
versioned first-party CAD feature add/update, sketch add/update, and variable add/set-expression
commands may use the grant. Every command in a draft must qualify and match its document and actor.
Feature updates also require an eligible unsuppressed prior record with the exact same feature type and schema version. The policy reads the current base revision and follows earlier add/update commands in the draft; it cannot unsuppress or replace an excluded feature through an update.
Deletion, suppression, variable replacement/rename, document metadata, unknown commands, extension
features, and future feature versions still require manual review. Exports, filesystem operations,
printing, credentials, pairing, access, and other projects acquire no new authority.

The existing host still performs exact geometry evaluation, actor ownership, expiry, revision,
resource bounds, and post-review revalidation. The ordinary atomic compare-and-commit path performs
redispatch, persistence, and one Undo checkpoint. Auto-apply changes only the browser review decision;
it does not implement another command engine or execute model-generated code.

## Lifecycle and UI

Opt-in requires an idle paired connection and no review. A commit captures the grant at invocation;
a later opt-in cannot authorize an already pending manual commit. The browser rejects overlapping
commit invocations on a single handle rather than sharing review authority between them.

Show a persistent **Auto-apply on** indicator with **Stop AI**. Stop immediately disposes the local
handle and revokes the whole pairing, before awaiting the network acknowledgement. Disconnect,
project change, page exit, reload, cancellation, or connection failure also revoke the grant.
The disposed handle rejects writes after async validation/review. An already accepted persistence
transaction finishes and reports its actual outcome; Undo remains available. Reconnecting requires
manual pairing and a fresh explicit auto-apply opt-in.

This preserves the single-client ephemeral lifecycle. A future persistent or multi-client service
would need a separate authorization and lifecycle decision; it is outside this grant.

## Verification

Exercise default manual review, blocked opt-in during work/review, allowed multi-command commits,
invalid geometry and repair, actor/document isolation, destructive fallback, stale revisions,
Stop during validation, project changes, Undo/Redo, save/reload, and fresh pairing without a grant.
Use real worker geometry and stdio MCP browser journeys in addition to policy/lifecycle unit tests.
