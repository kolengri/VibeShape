# ADR-0047: Local MCP Draft Inspection

- Status: Accepted
- Date: 2026-09-07
- Related: [ADR-0042](0042-exact-automation-draft-application-path.md), [ADR-0046](0046-local-mcp-selected-edge-inspection.md)

## Decision

Expose `draft_tree`, `draft_entity`, `draft_variables` and `draft_edges` through one serialized
automation host inspection operation. Reuse the four existing registered inspection queries over
the owned draft snapshot. Every request requires the draft ID and exact draft revision; the browser
injects its paired document ID. A strict result envelope identifies the draft and contains a bounded
query view for the same document and revision. Semantic inspection does not evaluate geometry.

Inspection does not renew the draft expiration time or persist document changes. It validates the
actor, ownership, expiration, requested revision and current committed base before reading. After
an asynchronous read or geometry calculation, revalidate the base and expiration before returning
or retaining results. The existing host queue serializes inspections with commands and lifecycle
operations; no second mutation path is introduced.

For edges, calculate a requested feature through the disposable document preview. Project exact
measurements and edge evidence from the same rebuild and terminate its worker on success, error,
cancellation or disposal. A successful source feature remains inspectable when a downstream
feature fails, so the client can repair its intent before asking for commit approval.

Retain at most one validated detached edge catalog per host, with a 4 MiB serialized budget and the
existing 10,000-candidate bound. Bind it to the draft ID, snapshot revision, target feature and rebuild
ID. Pages reuse this exact catalog. Successful draft mutations, discard and commit invalidate the
affected catalog. Expiration and base changes make it unavailable. An uncached or mismatched cursor
returns `stale-geometry`; it cannot cause a fresh rebuild to masquerade as the previous page source.
Starting at `cursor: null` may replace the cached target. No worker, native handle or mesh is retained.

The four named tools are read-only. The broker correlates successful responses to the paired
document, requested draft ID/revision, query kind, target entity/feature and cursor rebuild. Existing
operation, response-page, session and cancellation bounds continue to apply.

## Verification gate

Cover ownership, exact revisions, expired/discarded drafts, base changes during asynchronous work,
semantic reads without geometry, no expiration renewal, bounded catalog retention, page reuse,
invalidation and stale cursors. Preserve cancellation settlement and worker termination. Verify a
real MCP client can create source geometry, inspect draft edges, create and repair selected edge
treatments, preview, then commit the complete part with one browser Apply and one Undo transaction.
Require affected unit/browser tests, workspace types, formatting, lint, build and changed-code audit.

## Verification results

Verification on 2026-09-07 passed:

- Full unit suite: 1,779 tests in 220 files with `bun run test --maxWorkers=4`.
- The final independent budget/discovery check passed all 8 focused tests after strengthening the
  catalog-budget fixture to prove it satisfies the underlying domain schema.
- One uninterrupted browser run passed all 96 cases in Chromium, Firefox and WebKit with three
  workers. It covered `local-mcp`, `local-mcp-cad`, `local-mcp-variables`, `local-mcp-edges`,
  `local-mcp-draft-inspection`, `local-mcp-cancellation`, `local-mcp-protocol`, `local-mcp-visual`,
  `automation-document-commit`, `automation-document-cancellation`, `automation-review`,
  `automation-draft-geometry`, `selected-edge-treatment`, `selected-edge-picking`,
  `selected-edge-worker`, `edge-treatment` and `edge-treatment-worker`.
- Workspace typechecking, scripts typechecking, formatting, lint, production build, English/local
  links and whitespace checks passed. Fallow exited 0 with only the two previously investigated
  Bun override warnings. No new suppression or package-boundary exception was added.
- Independent owner review reported no actionable findings. Primary review added committed-base
  validation before inspection and detached snapshots before invoking the geometry port; dedicated
  regressions verify both boundaries and revalidation after asynchronous work.

The first broad browser run passed 93 cases and exceeded old five-second waits in three cases
covering cold opening, post-reload geometry and the geometry-dependent review dialog. Those specific
asynchronous assertions now wait up to 30 seconds for their actual readiness state. The final full
run passed in isolation. This changes test synchronization, not the product's startup performance
budget; ordinary-build cold-start and memory measurements remain release work.

## Remaining scope

Draft profile and face inspection, constituent bodies, further named CAD commands, durable tool
provenance and local release gates remain separate work.
