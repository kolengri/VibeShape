# ADR-0150: Chamfer authoring route

- Status: Accepted
- Date: 2026-11-10
- Partially supersedes: the closed cone/cylinder bound of the compatibility route and the
  scope-switch defaults in [ADR-0149](0149-rounded-opening-edge-treatments.md)

## Context

ADR-0149 made V3 with native tangent propagation the default for new UI chamfers and kept V2 only
for closed cone/cylinder rims. Every other curved edge that V3 cannot measure, such as a plane/cone
countersink rim, a split cone/cylinder arc, or an elliptical, spherical, toroidal or spline edge,
then lost the V2 path it had used before and could not be chamfered at all. Route state was also
written from several controls: touching an advanced control latched a saved V2 feature into V3,
and returning from All edges to Selected edges rewrote saved propagation and schema choices.

## Decision

One function owns the Chamfer schema route. The form stores no route latch.

- All edges authors V1 unless the body requires V3.
- A body with named or multiple outputs always authors V3.
- A new task on a body-bound catalogue and an edit of a saved V3 feature author V3.
- An edit of a saved V1/V2 feature authors V3 only while advanced intent is present: a directional
  mode, Tangent measurement, enabled propagation, flip, direction overrides or a face target.
  Restoring those controls restores the saved schema.

The compatibility route from ADR-0149 now covers every selected edge that V3 cannot measure. Its
other conditions are unchanged: a new task, a verified single-result body, enabled native
propagation, equal-distance Offset, losslessly represented edge selections and no side-face or
directional intent. V2 runs the native builder over whole tangent contours without a measured
setback claim, which is the behavior these edges had before ADR-0149. The route is chosen before
validation; a failed V3 operation is never retried through V2. V3 measurement support is not
broadened, and MCP callers keep their explicit contract.

When a new task leaves that route through explicit intent, validation names the recovery: the
plain equal-distance Offset chamfer with propagation enabled and edge targets only.

Visiting All edges still presents neutral controls. Returning to Selected edges restores the mode,
measurement, flip and propagation that were replaced, plus the exact targets and direction
overrides when the target body is unchanged. A task that never held selected-scope intent gains
none.

An empty selection is not reported as a validation error before a submit attempt.

## Consequences

A tangent contour that starts on a V3-measurable seed and continues over an unsupported edge is
still rejected by the worker, because the form cannot see native contours. Explicit propagation
opt-out on an unmeasurable edge remains rejected, with the recovery named.

## Evidence

Form tests cover plane/cone, split cone/cylinder and spherical rims on the compatibility route and
their recovery message after opt-out, saved V2 features after each advanced control and the scope
are changed and restored, lossless scope round trips for new and saved V3 intent, and the absence
of a selection error on an empty task. The ADR-0149 route bounds for saved V3, named outputs, face
targets, directional modes and unverified bodies remain covered.
