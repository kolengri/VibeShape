# ADR-0051: Body-bound topology inspection

- Status: Accepted inspection contract; persisted consumer gates open
- Date: 2026-09-13
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md), [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md)

## Decision

Extend the existing domain topology, application evidence, and ordinary query/MCP owners. A separate
body topology reference version 1 includes the existing kind, semantic/history/signature/intent
fields, the producing feature ID, and a required normalized `outputRole`. Its resolution first
requires an exact feature/body match, then applies the existing conservative topology resolver
inside that body's candidate set. Missing bodies never use aggregate or sibling topology, even
when candidate IDs, semantic roles, signatures, or geometry coincide.

Keep ordinary TopoRef version 0 and its existing persisted consumers unchanged. They reject the new
reference rather than discarding its scope. Introducing a persisted consumer requires a subsequent
explicit feature/schema version, canonical reference identity including the role, matching ordered
input roles, worker validation, replay/native backup, and explicit repair. Inspection does not
certify those future consumers or complete ADR-0049 Stage 2.

## Inspection boundary

Register `org.vibeshape.model.body-topology` version 1 and expose it through the read-only local
`model_body_topology` tool. The request identifies a committed document revision, producing feature,
required output role, and either `edge` or `face`. The result contains body-bound references and
their conservative resolution status. It never exposes native handles or makes candidate IDs
persistent modeling identity.

The application validates the current document-worker response, complete feature/evaluation
coverage, successful source hash, and complete body catalog before selecting the exact body.
Candidate counts and identities must match the selected body's declared topology. Duplicate body
roles, duplicate candidates, partial catalogs, failed/suppressed features, stale evidence, and
missing roles fail closed. Derived mesh, native acquisition keys, and display geometry do not enter
references.

Evidence and page cursors bind document, revision, generation, rebuild request ID, feature ID,
content hash, body role, and topology kind. Pages contain at most 100 references and 128 KiB of
serialized UTF-8. Semantic/history uniqueness is computed over the full selected body and kind,
never one page. A cursor from another body, kind, or rebuild is rejected. Existing `model_edges`
and `draft_edges` retain their whole-feature version-1 behavior; this increment reads committed
body topology only.

## Required evidence

- Strict v1 body references; unchanged v0 rejection/acceptance and conservative missing/ambiguous
  outcomes; no cross-body resolution for coincident candidates.
- Application rejection of stale, failed, malformed, incomplete, wrong-hash, and missing-role
  evidence without aggregate fallback; face and edge coverage.
- Registered query ownership, strict provenance/cursors, full-body uniqueness, bounded pages and
  UTF-8 output; unavailable contexts remain unavailable.
- Real paired MCP discovery, client-valid input/output schemas, committed Box/Hole face and edge
  inspection, stale revision/cursor rejection, and unchanged legacy edge tools.
- Full relevant types/tests, Fallow, build, and affected Chromium/Firefox/WebKit workflows.

Native pattern producers, body-bound selected-edge treatment, sketch support, persisted reference
repair, and exact draft body inspection remain subsequent increments.

## Implementation evidence

The registered query and read-only MCP tool are implemented. Full-set candidate membership and
canonical comparison prevent manufacturing a scoped reference from an unrelated or altered candidate.
Protocol validation rejects duplicate catalog roles and geometry records; application validation
additionally rejects inconsistent aggregate roots despite valid body entries. The response broker
checks the requested owner, role, kind, and full cursor provenance before forwarding a result.

The full unit suite passes 1,986 tests in 245 files. An uninterrupted 18-case three-browser MCP matrix
covers Box/Hole topology, existing selected Fillet/Chamfer repair, legacy edge queries, host review,
undo, and exports. The subsequent root-evidence check has an additional final-build browser rerun;
see the [development plan](../product/local-cad-and-mcp-development-plan.md) for exact evidence and
remaining native/persisted authoring gates. Existing v0 consumers remain unchanged.
