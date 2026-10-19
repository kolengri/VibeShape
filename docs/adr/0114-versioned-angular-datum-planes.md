# ADR-0114: Versioned angular datum planes

- Status: Accepted
- Date: 2026-10-19
- Supersedes: [ADR-0025](0025-first-class-offset-datum-planes.md) for the latest datum-plane parameter and frame contract; its reference ownership and support-health rules remain in force.
- Follows: [ADR-0034](0034-versioned-multi-profile-feature-input.md) for persisted feature versioning and explicit edit upgrades.

## Context

Reusable sketch supports need a variable-driven angle as well as a signed offset. Datum-plane feature
schema v1 has a strict offset-only parameter shape. Adding a rotation to that same version would cause
older runtimes to recognize the type while rejecting its parameters, instead of reporting a newer
unavailable feature version.

## Decision

Keep the `org.vibeshape.feature.reference-geometry.datum-plane` v1 descriptor and handler registered
with their original strict offset-only schema. Add v2 in the same reference-geometry module for new
planes. V2 retains `mode: "offset"`, support and length quantity, and accepts optional
`rotation: { axis: "x" | "y", angle: AngleQuantity }`. Angles resolve through the existing dimensional
expression boundary into canonical radians, bounded inclusively to `[-2π, 2π]`. Missing rotation means
zero rotation. Source units, literals and variable expressions remain authored intent.

Opening, reading and rebuilding a v1 plane do not upgrade it. An explicit ordinary feature update from
the editor or datum-plane automation tool writes v2 while preserving the feature ID, dependencies,
references and unrelated metadata. Preview remains disposable. Cancel preserves the original record;
committed Undo restores its exact prior v1 state. No document or archive schema migration is required.
Runtimes without v2 use the existing unavailable-feature compatibility path; they must not reinterpret
v2 as v1 or erase its parameters.

Resolve the support's exact right-handed frame first. Translate its origin along the original normal
by the signed offset, then rotate its basis around its local X or Y axis through that translated origin.
Positive angles follow the right-hand rule. A missing or zero angle returns the exact prior frame.
Canonical content parameters omit an absent or zero rotation, while the feature version remains part
of content identity; v1 caches do not change and v1/v2 feature identities remain distinct.

The document worker prepares the resulting orthonormal frame through the existing protocol. Both
versions use the same bounded display plate implementation in the geometry worker. Datum planes stay
outside body ownership, thumbnails and STEP/STL/3MF export. Downstream geometry uses the logical frame,
never plate thickness, transient face order or native IDs.

The existing oriented `datum.plane` face-support health contract remains unchanged: changing a normal,
including through an angle-variable update, may require explicit sketch support reselection. A feature
ID does not bypass a missing or ambiguous oriented reference. The edit form and operator instructions
explain this limitation.

The Model browser groups XY, XZ, YZ and authored datum planes under **Planes**, using the existing feature
actions and separate History records. Creation and explicit reveal open the group. The editor exposes
the support, offset, local rotation axis and angle through the existing preview/Apply/Cancel workflow.

## Consequences

- Old offset-only records retain their strict accepted semantics and rebuild behavior.
- New angled planes round-trip with their version and expressions through persistence, native backup,
  edit and Undo/Redo without adding a kernel or worker authority.
- Verification covers v1/v2 dispatch, rejected rotation under v1, unavailable-version handling, explicit
  upgrades, signed rotations on all origin frames, zero-angle behavior, expressions and native retention.
- Mid-plane, arbitrary line-at-angle, three-point, tangent, axis and point reference modes remain separate
  capabilities. This decision adds support-local rotation only.

## Rejected alternatives

- **Widen v1 in place:** breaks the persisted feature-version compatibility boundary.
- **Upgrade on load or preview:** changes authored identity without an explicit committed action.
- **Store a world transform:** loses the semantic relationship to a moving support.
- **Retarget oriented references by feature ID:** would silently change the existing fail-closed support
  repair contract.
