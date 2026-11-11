# ADR-0157: Revolve end conditions and per-profile outputs

- Status: Accepted
- Date: 2026-11-11
- Extends: [ADR-0028](0028-selector-backed-origin-axis-revolve.md),
  [ADR-0030](0030-explicit-target-revolve-operations.md),
  [ADR-0078](0078-extrusion-end-conditions-and-fastener-recesses.md), and
  [ADR-0083](0083-exact-body-revolve-and-subtract.md)

## Context

Revolve versions 1–7 sweep one angle from the sketch plane. Symmetric and two-sided angles, a sweep
that stops at an existing body or face, and downstream identity for the separate solids of a
multi-profile New revolve were open. Extrude already owns these concepts in ADR-0078: a flat
symmetric/reversed/second-extent shape, end conditions bound to an exact body revision, and
body-bound faces resolved strictly against current topology.

## Decision

Add `org.vibeshape.feature.part-design.revolve#8`. Versions 1–7 remain registered, strict, and
replay unchanged.

### Parameters

Revolve v8 mirrors Extrusion v6:

- `profiles` is the canonical same-sketch selector set, even for one profile;
- `angle` is the one-sided angle, the symmetric total, or the first side;
- `symmetric` splits `angle` equally across the sketch plane and forbids `reversed` and a second
  angle;
- `secondAngle` (nullable) sweeps opposite the first side; first plus second is at most 2π;
- `reversed` flips the first direction;
- `targetBody` is null for New and an exact `BodyReference` for Add, Remove, and Intersect;
- `endCondition` is `angle`, `up-to-body`, or `up-to-face`. Dynamic endpoints name an exact body,
  its captured `sourceContentHash`, and, for faces, a stable `BodyFaceRef` on that body. They are
  one-sided; reversal remains allowed.

Every angle is a variable-aware `Quantity` bounded to (0, 2π] and revalidated after expression
resolution. Dependencies are the modifying target, the sketch support, the model-edge axis owner,
and the endpoint owner, each once and in that order. Geometry inputs retain the endpoint body
without consuming it. A sketch support retains its whole result slot.

### Authoring route

`routeRevolveAuthoring` is the single owner of the schema choice. New features author v8. An edit
keeps its saved version while that version can represent the edited intent. It moves to v8 when a
v8-only option is chosen (symmetric, reversed, a second angle, or an endpoint) or when the saved
version cannot hold the intent, for example a named output role as the target of a version 4 or 6
record. Restoring the saved intent restores the saved schema. MCP callers keep their explicit
contract: `create_revolve`/`update_revolve` select v8 when the v8 fields are supplied.

### Evaluation

The document worker resolves the axis and profiles exactly as for earlier versions, then binds a
dynamic endpoint only when the current producer content hash equals the captured hash and the role
is one valid solid. A missing, stale, or ambiguous face blocks preparation instead of retargeting.
Prepared content carries authored angles, flags, the bound endpoint, and one output role per
profile.

The geometry worker rotates the analytical profile face to the swept interval's start and calls
`BRepPrimAPI_MakeRevol` once per profile:

- one-sided: [0, θ];
- symmetric: [−θ/2, θ/2];
- two-sided: [−θ₂, θ₁], with reversal applied by sweeping about the negated axis.

For a dynamic endpoint the worker sweeps an overlong tool through 359 degrees and cuts it by the
endpoint body. It keeps the unique component that retains the complete sketch-plane start cap and
none of the overrun cap, reusing the Extrude endpoint machinery with a distinct overrun-cap
normal. Up-to-face additionally records Boolean history and requires every newly created face of
the kept component to lie on the selected finite face. Unreachable endpoints, partial profile
coverage, a start inside the body, and a selected face that is not the first contact fail with a
feature diagnostic. The face is resolved from the exact body's topology snapshot with the strict
resolver Shell uses; missing and ambiguous faces name their state.

### Per-profile outputs

A New v8 revolve with several profiles builds each profile's solid separately and fuses copies:

- one merged solid publishes the ordinary `result` output;
- one separate solid per profile publishes each profile's solid as
  `revolve.profile.<h>`, where `<h>` is the 16-hex-digit 64-bit FNV-1a hash of the profile's
  complete sorted outer-boundary `SketchEntityId` list joined by commas. This follows the
  identifier-based role convention of Compound (`body.<slot>`) and import (`import.<output>`) while
  staying within the 128-character role limit;
- any other partition fails closed, because a partially merged solid has no stable per-profile
  identity.

One sketch region has exactly one outer boundary, so distinct selected regions have distinct
boundary sets; two adjacent regions that share an edge, even their lowest-ID edge, still get
distinct names. Should two roles ever coincide (a 64-bit hash collision), the worker fails closed
with a diagnostic instead of publishing an ambiguous name. The role derives from the profile's own
boundary, so adding or removing other profiles does not renumber it. Outputs are cached together and restored by role on a B-Rep cache hit; a
downstream exact-body feature resolves one role through the ordinary slotted input path.

### Native ownership

Every native temporary, including rotated faces, overlong tools, cut parts, fused copies, and the
resolved endpoint face, is released on success and failure. Partition and fuse helpers take
ownership of their input tools and release all of them when any step fails.

## Evidence for until-face

The replicad-opencascadejs 0.23.0 declarations expose `BRepFeat_Form` and `BRepFeat_MakeDPrism`
only; `BRepFeat_MakeRevol` and its until-face `Perform` overloads are not compiled into this build.
Even where available, it is a form-feature builder that needs a base shape and a sketch face lying
on that base, which a New revolve and a profile on an unrelated sketch plane do not have. The
construct-then-trim route reuses
the already proven Extrude endpoint path and was verified against the real kernel: a 2–5 mm by 4 mm
rectangle stopped at the axial face of a blocking body matches the analytic quarter-turn Pappus
volume and bounds, a face behind the first contact and an unreachable body are rejected, and a
dynamic endpoint with a second angle is rejected before native work.

## Consequences

- Symmetric, two-sided, and reversed revolves, and revolves that stop at a body or face, are
  ordinary replayable features with undo, persistence, preview, and MCP parity.
- Separate solids of a multi-profile New revolve are downstream targets.
- A multi-profile New v8 selection whose profiles partially merge fails where v5 produced an
  untargetable compound; the diagnostic names the requirement.
- The endpoint must be reached within 359 degrees of sweep; faces in the final degree before the
  start cap are unreachable.
- Up-to-face never extends a finite face, and a face hidden behind another face of the same body
  is not reachable.
- Caps are matched as half-planes on the profile's side of the axis, so a first contact lying in
  the sketch plane across the axis (a half turn) or in the overrun-cap plane is reached correctly.
  Only the part of each coplanar face on the cap's side is measured: a face that straddles the axis
  is clipped by an exact half-plane face before its area is taken. This covers a profile touching
  the axis whose start cap lies on a target face spanning the axis, where OCCT merges the start cap
  and the half-turn contact into one face centred on the axis.
- Output names are stable only while the partition and each profile's boundary are unchanged:
  - a single-profile revolve, and a multi-profile revolve whose profiles merge, publish `result`;
    adding a separate profile renames that output to per-profile `revolve.profile.<h>` names, and
    removing profiles down to one, or adding a bridging profile that merges the solids, collapses
    the names back to `result`;
  - a sketch edit or reselection that changes a profile's outer-boundary entity set (for example
    replacing, splitting, or trimming one of its boundary entities) renames that profile's output;
  - in every rename a downstream reference to the previous role resolves as missing and requires
    explicit repair; it never retargets to another solid.

## Rejected alternatives

- **`BRepFeat_MakeRevol` until-face:** absent from this WASM build, and unusable for New and for
  profiles not lying on the target even in builds that include it.
- **Analytic angle to a face plane:** exact only for planes containing the axis and silent for
  every other face.
- **Lowest outer-boundary entity as the role:** adjacent regions that share their lowest-ID edge
  would collide, and replacing that one entity would rename the output.
- **Index-based profile roles (`revolve.profile.0`):** editing the selection would retarget
  downstream references.
- **A discriminated `extent` union:** diverges from the Extrude shape and its validation for no
  semantic gain.
