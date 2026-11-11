# ADR-0151: Body-bound variable-radius Fillet

- Status: Accepted
- Date: 2026-11-10
- Extends: [ADR-0040](0040-selected-edge-treatments.md),
  [ADR-0118](0118-body-bound-directional-chamfer.md) and
  [ADR-0150](0150-chamfer-authoring-route.md)
- Supersedes: the "Fillet retains its current versions" statement in ADR-0118 and the
  Fillet scope of the "no Fillet schema change" note in
  [ADR-0149](0149-rounded-opening-edge-treatments.md)

## Context

Fillet V1/V2 bind to a single-result body through `FeatureRecord.references`. After Pattern, Split
or another named or multi-output producer, the editor offered no Fillet target at all. Chamfer V3
already solved exact body binding. Fillet also had no face targets and no variable radius.

## Decision

Register Fillet schema version 3 on the existing `org.vibeshape.feature.part-design.fillet` type.
Its parameters store an exact `targetBody` (including the output role), an expression-capable
constant `radius` and 1–256 distinct `targets`. Each target is an edge or a face. Every reference is
owned by the target body. Generic feature references are empty and the target body's producer is
the sole dependency. Only semantic body-bound references are persisted. Native edge hashes and
indices exist only during one evaluation. Radii are bounded to 0.001–100000 mm.

A face target fillets its current native boundary edges. Seam and smooth boundary edges that have no
fillet contour are skipped, but at least one contour must exist. An explicit edge with no contour
fails with a reselection message.

Every target follows its complete native tangent contour, which is OCCT `BRepFilletAPI_MakeFillet`
behavior. V3 has no propagation toggle, because the native builder cannot fillet part of a tangent
chain. The schema, UI help and MCP descriptions state this.

An edge target can add `variableRadius { startRadius, endRadius, reverse }`, a linear law along the
edge. OCCT parameterizes that law from the contour's first vertex, which follows native edge
orientation. Orientation can change between rebuilds, so it is not persisted. The durable rule is:

- start is the edge endpoint that sorts first by x, then y, then z in the target body's model
  coordinates, and coordinates within 1e-3 mm (1 µm) compare equal. The tolerance is persisted
  meaning, so it stays above the numeric noise of imported and Boolean geometry;
- `reverse: true` swaps start and end;
- the worker adds the edge, reads the contour's first and last vertices, and assigns
  `startRadius`/`endRadius` to them according to the rule above.

Variable radius is accepted only where the law is deterministic. The edge must be open and must be
its own complete tangent contour. A tangent chain, a closed edge, or an edge also reached by another
target or contour fails explicitly; the worker never guesses an extension. Equal start and end radii
are rejected, because that law is the constant radius.

The editor uses one Fillet route function, which mirrors the Chamfer route owner from ADR-0150:

- a body with named or multiple outputs always authors V3;
- All edges authors V1 on a verified single-result body;
- a saved V3 feature stays V3;
- a face target or an active variable radius authors V3;
- otherwise a selection on a verified single-result body authors V2, which keeps the proven
  legacy builder and its tested-radius diagnostics. A saved V1/V2 feature therefore keeps its
  schema unless a face or variable radius is added. Removing that intent restores the saved schema.

The route is chosen before validation. A failed V3 build is never retried as V2. Local and paired
MCP accept the same strict V3 `parameters` alternative on `create_fillet` and `update_fillet`,
beside the unchanged legacy flat contract.

## Consequences

Fillet works on every exact solid body, including Pattern instances and Split halves. Chamfer V3 and
Fillet V3 share the body-bound reference resolver in the geometry worker. A rigid upstream transform
that reorders an edge's endpoints moves its variable-radius start. The rule stays deterministic for
the current geometry, and the user can toggle Reverse. V3 failures do not run the V2 smaller-radius
probe; they report a reduce-radius or reselection message.

The rule compares coordinate differences, so an upstream translation never moves the start; only a
rotation can. Persisted endpoint anchors, as proposed for projected sketch splines in ADR-0158, were
evaluated as a replacement and not adopted:

- Sketch anchors live in the sketch frame, which turns with its support. A body has no frame that
  survives Placement, Pattern or Boolean history, so Fillet anchors would be model coordinates.
  Pairing current endpoints with model-coordinate anchors reduces to the sign of the dot product
  between the authored and current chords: it keeps the start through rotations below 90 degrees,
  flips it beyond 90 degrees, and is ambiguous at 90 degrees.
- A quarter-turn Placement is the most common rotation. Anchors would have to fail closed there,
  turning a deterministic build into a repair task, while the coordinate rule still builds.
- Anchors need a Fillet V4 schema, authoring-time endpoint capture in the editor and in both MCP
  transports, and a repair path, for a guarantee that still does not cover large rotations.

Reverse remains the repair for a rotated body. The decision should be revisited if bodies gain a
persistent local frame that follows rigid transforms.

## Evidence

Real-kernel worker tests cover:

- the analytic constant-radius volume r²(1−π/4)·L on every box edge, at two radii;
- the endpoint rule on all 12 edges of a box and of a mirrored extrusion, in both `reverse` states,
  measured from fillet setbacks at each original corner;
- variable-radius removal bounded by the constant start-radius and end-radius cases;
- identical geometry after a reopened source with new native topology;
- the same physical start after an upstream translation of the source body;
- equivalence of a face target and its four boundary edges;
- tangent-contour following on a rounded opening;
- rejection of variable radius on tangent chains, closed rims and overlapping targets;
- missing edges and oversized radii.

Mocked worker tests prove that native temporaries are disposed on each failure path. Engine tests
cover persisted reopen, face targets, a named Pattern output, wrong output roles, and missing and
ambiguous references without leaked shapes. Domain, protocol, form and MCP tests cover ownership,
distinctness, bounds, law validation, content identity, route selection, face picking, variable
radius controls, saved V2 and V3 edits, and the strict MCP union.
