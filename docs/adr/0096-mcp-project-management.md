# ADR-0096: Browser-owned MCP project management

- Status: **Accepted**
- Date: 2026-10-04

## Context

The document pairing in ADR-0043 and recovery in ADR-0095 intentionally bind CAD authority to one
active project. Creating/opening another project currently reloads the editor. An agent cannot
author several separate projects without losing that pairing.

## Decision

Extend the existing browser document controller, not the CAD kernel or MCP persistence authority.
Expose shared local/remote `list_projects`, `create_project` and `open_project` tools. A separate,
browser-owned **Allow project management** grant defaults off and covers catalog names and project
creation/navigation for the live paired tab. It is never supplied by a tool or restored by recovery.

Create/open use exact expected source project identity and committed revision. The ordinary
persistence create/open paths prepare the destination, protect saved source state and writer access,
and publish a new document session in place. Guard editor drafts, reviews, saves and concurrent
navigation. Dispose previous document authority and private automation work on a different project;
reset CAD auto-apply. Same-project open leaves the session and grants unchanged.

The transport stays paired only for an explicitly authorized transition. Local broker authority
changes after a correlated successful result that matches the requested destination; otherwise a
changed poll document remains forbidden. The remote session remains bound to the approved browser
tab. Both browser connections replace the document handle and revoke on manual navigation or Stop.
CAD tool input may include an explicit `projectId` guard. The adapter separates it from strict
authored payloads, and the browser rejects mismatched targets before any command dispatch.

Catalog pages contain at most 100 project summaries without thumbnails. Cursor ordering uses exact
project IDs. No new document/file schema or kernel API is required.

## Consequences

Agents can create A, author it, create B and reopen A over one transport while each model remains
browser-local. Ordinary revision checks, geometry preview/review, persistence and Undo still apply.
Project creation itself is persisted through the ordinary document-create command; it is not a
disposable CAD draft. Unknown outcomes must be inspected before retrying to avoid duplicate projects.

Auto-apply and the project-management grant have different scope. A new project requires a new
auto-apply opt-in; recovery does not silently regain catalog access. Project deletion, cross-tab
authority, headless storage and direct file edits remain outside this contract.

Tests cover schemas, exact transition receipts, denied grants, stale source/target identity,
cancellation, pairing continuity and saved geometry when returning to another project.
