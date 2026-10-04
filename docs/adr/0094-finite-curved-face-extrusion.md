# ADR-0094: Exact extrusion to a finite curved face

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0078](0078-extrusion-end-conditions-and-fastener-recesses.md)

## Decision

Register Extrusion v7 as a separate, strict up-to-face contract. It accepts a current stable
`BodyFaceRef`, including nonplanar surfaces, and retains v6's exact modifying target, typed signed
start offset and draft angle, one-sided extent, captured endpoint content hash, and canonical
target/support/endpoint dependency ordering. Existing v1–v6 decoders, replay and native behavior
remain unchanged. A v7 endpoint can later become planar without downgrading its saved schema.
Other end conditions continue using the existing versions.

The worker prepares curved endpoints as `up-to-curved-face`, with the exact input slot, output
role, captured content hash and resolved finite face. It does not invent a tangent plane. The
native worker resolves that face against the current named body, then uses OCCT's exact CUT on
an owned overlong prism and the borrowed endpoint body. Non-destructive mode and native Boolean
history preserve the original prism boundary identities.

The accepted result is the unique valid positive-volume solid carrying the complete original
start cap and no overrun end cap. Every newly created boundary face must lie completely on the
selected finite face, verified by exact face Common area. The aggregate new cap area must be
positive. Original prism boundaries and their native history descendants are excluded from that
cap check. Native identity comparisons are local to this evaluation; no transient native face
or edge index is persisted.

This closes curved endpoint support without new kernel bindings, a kernel migration, sampled
rays, mesh intersection, or implicit extension of a finite patch. A partially covering support,
neighboring face, unreachable endpoint, start inside the endpoint, multiple covering components,
stale content hash, or ambiguous stable reference fails closed. A far curved face behind another
boundary is not treated as an instruction to extend the endpoint's surface through its body.
Planar v7 endpoints retain the established exact plane clipping and finite-face coverage check.

Only the modifying target is consumed. Endpoint bodies remain retained, including when target
and endpoint share one producer's `result` role. Duplicate producer dependencies are listed once;
conflicting constituent role bindings remain invalid. Cached source shapes and the selected
support face are borrowed. Boolean builders, lists, history wrappers, temporary solids and failed
results are disposed on every success or failure path.

## Authoring and automation

The editor chooses v7 when a user selects a current curved endpoint. Editing a v7 up-to-face
feature preserves v7 even after choosing a planar endpoint. A source change requires explicit
inspection and repair of the captured binding; neither UI nor automation silently refreshes it.

Additive `create_face_extent_extrude` and `update_face_extent_extrude` tools publish the v7 contract
on local and paired remote MCP. Existing `create_extrude` and `update_extrude` remain v6-compatible.
All tools use ordinary actor-owned draft commands, exact revision checks, disposable preview and
browser review. V7 and upgrades to it remain outside the session auto-apply version allowlist.

## Validation and limits

Real OCCT tests cover spherical and cylindrical caps, finite partial patches, mixed neighboring
caps, unreachable and inside-start cases, unchanged borrowed sources, injected native inspection
failure and disposal. Worker tests cover current body evidence, legacy rejection, stale hashes,
role mismatch and partial coverage. Schema and form tests preserve old versions, exact target
binding, dependency deduplication, endpoint retention and planar edits of saved v7 features.

Schema-valid curved surfaces may still fail native Boolean or coverage validation. Support is
bounded by exact complete-cap construction, not by a promise that every surface arrangement is
reachable. Failed previews cannot commit. The existing draft angle, workspace, profile and native
resource bounds continue to apply.
