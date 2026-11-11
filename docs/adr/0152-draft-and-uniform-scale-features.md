# ADR-0152: Draft and uniform Scale features

- Status: Accepted
- Date: 2026-11-10

## Context

A draft angle existed only as an Extrude parameter, so faces of an existing body could not be
tapered for molding, and no feature could resize a body. Both operations modify one exact solid and
must use the established body-bound reference, worker, preview and history contracts rather than a
parallel path. The pinned `replicad-opencascadejs` 0.23.0 WASM build exposes
`BRepOffsetAPI_DraftAngle`, `gp_Trsf.SetScale` and `BRepBuilderAPI_Transform`. It does not expose
`BRepBuilderAPI_GTransform`, so a general affine (non-uniform) transform is unavailable. Its
`Draft_ErrorStatus` enumeration is unbound, so `BRepOffsetAPI_DraftAngle.Status()` throws instead of
returning a reason.

## Decision

Both are first-party `org.vibeshape.core.part-design` solid features that replace the body of the
same authored part and keep its history, like Shell and Placement.

**Draft** (`org.vibeshape.feature.part-design.draft` schema 1) persists the exact target body,
1–256 unique body-bound face references of that body, a neutral plane, an angle quantity and a flip
flag. The neutral plane reuses the shared reference-plane contract (origin plane, Datum Plane,
explicit plane or planar face). A planar neutral face must belong to the target body and cannot also
be drafted. A Datum Plane producer follows the target as the second dependency; body topology lives
only in parameters. The angle is expression-capable and bounded to more than 0 and less than 89
degrees.

Document content preparation resolves the neutral plane to an origin and unit normal and derives the
pull direction: the plane normal for origin, Datum and explicit planes, and the reverse of the
outward normal for a planar face, so drafting walls about their base face narrows them away from it.
`flip` reverses the pull direction. A positive angle tilts each selected face about its intersection
with the neutral plane so the body narrows along the pull direction. Tangent-connected faces are
drafted with a selected face (OCCT propagation).

The worker resolves every face through the existing exact/durable body-face resolver, then adds the
faces to `BRepOffsetAPI_DraftAngle` in authored order. Because the status enumeration is unbound,
`AddDone()` and `IsDone()` are the failure signals. A rejected face fails the whole feature with its
1-based selection index and an actionable message; no face is skipped. The result must be one valid
positive-volume solid.

**Scale** (`org.vibeshape.feature.part-design.scale` schema 1) persists the exact target body, a
unitless expression-capable factor bounded to 0.001–1000, and a center: the world origin, the
axis-aligned bounding-box center of the source body (computed in the worker), or an explicit point
of three length quantities within ±100,000 mm. The worker copies the source through
`gp_Trsf.SetScale` and `BRepBuilderAPI_Transform(copy=true)`; the cached source is never modified.
Non-uniform scale is not offered.

Both features own task panels, toolbar/context-menu/palette commands with new colored icons, History
icons and MCP tools (`create_face_draft`, `update_face_draft`, `create_scale`, `update_scale`) over
the same draft, preview and commit path. Draft tools are named `*_face_draft` because
`create_draft` already opens an MCP draft session. Draft face picking reuses the Shell viewport
picking channel and a shared keyboard-accessible face checklist.

## Consequences

- Native face indices, hashes and candidate IDs are never persisted; edits that lose a face require
  explicit reselection, as for Shell and Chamfer face targets.
- Draft and Scale results publish no semantic roles or lineage tokens, so downstream face references
  to their outputs are exact signature matches. Changing a Scale factor or a Draft angle therefore
  requires reselecting downstream faces.
- Draft cannot report OCCT's per-face failure category until the WASM build binds
  `Draft_ErrorStatus`. Delete/replace face and non-uniform scale remain blocked by the missing OCCT
  modules in this build.

## Evidence

Real-kernel tests cover the four side faces of a box drafted about its base into the analytic frustum
volume, flipped taper, a cylindrical wall drafted into a cone frustum, failure on a face parallel to
the neutral plane, factor-two scaling multiplying volume by eight, fixed origin, bounding-box and
explicit centers, and engine evaluation of a named Pattern output with balanced shape ownership on
failure. Domain, preparation, form, MCP schema/adapter and Chromium end-to-end tests cover bounds,
ownership, expressions, content identity, picking, single-flight Apply, undo and reopen.
