# ADR-0132: Current planar face sketch support

- Status: Accepted
- Date: 2026-10-27
- Extends: [ADR-0024](0024-stable-planar-face-sketch-support.md), [ADR-0114](0114-versioned-angular-datum-planes.md) and [ADR-0131](0131-exact-face-signature-resolution.md)
- Supersedes ADR-0024's analytical-producer restriction for whole-result planar supports.

## Decision

Accept a current, oriented planar face from a whole-result body as a sketch or datum support,
independently of its producing feature type and optional semantic role. Keep the existing v0
planar `TopoRef`, topology resolution policy and dependency contracts. Tessellation face IDs join
one current selection to a candidate only; they never enter persisted intent.

Retain established analytical frames for primitive faces, distance extrusion caps and logical datum
planes. Otherwise resolve the durable reference against current exact topology, require one oriented
`PLANE`, project the persisted anchor onto that plane, and construct a deterministic right-handed
orthonormal basis. Use the same resolver for sketches and face-supported datum planes, and forward
current dependency geometry during datum content preparation. Dynamic extrusion caps use their
actual resolved geometry rather than nominal authored distances.

For an existing oriented reference, project its authored tangent seed onto the current plane rather
than choosing a new world-axis fallback after each rebuild. This prevents a tiny support tilt across
the fallback threshold from reversing both sketch axes. A degenerate projection fails closed and
requires explicit reselection.

When a selection supplies no independently chosen spatial hint, store its exact signature without
inventing `intent` from the same centroid and normal. Such synthetic hints would disable identical
signature precedence for adjacent coplanar lands. The stored centroid remains the fallback frame
anchor. Existing authored explicit intent, semantic roles and lineage keep their resolution policy;
missing or ambiguous references require reselection, including after an upstream edit.

Datum display caps retain their authored orientation filter because opposite caps share one role.
Curved, unoriented, missing and ambiguous faces remain unavailable. Named constituent body outputs
remain unavailable for sketch support: v0 references do not carry `outputRole`, and aggregate
fallback would discard body identity. A body-bound support needs a separate versioned contract.

## Consequences

- Boolean, treatment and placed planar results can support ordinary sketches without a producer whitelist.
- Sketch creation, solving, display, downstream features and datum preparation share the same current frame.
- Existing sketch coordinates and serialized formats remain unchanged. Older runtimes may explicitly
  reject these previously unsupported references; they must not reinterpret them as origin planes.
- Real-kernel regressions cover Boolean, Fillet, Chamfer, rotated Placement, signed/oblique planes,
  downstream geometry, cold rebuild, resource disposal and rejection cases. Browser regressions cover
  face picking, sketch authoring/reopening and datum preview on an extrusion side.
