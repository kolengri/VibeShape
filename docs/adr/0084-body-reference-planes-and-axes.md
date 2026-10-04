# ADR-0084: Body reference planes and axes

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0025](0025-first-class-offset-datum-planes.md), [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md), [ADR-0051](0051-body-bound-topology-inspection.md), [ADR-0061](0061-exact-plane-split-and-part-fan-out.md), and [ADR-0077](0077-mirror-copies-and-draft-shell-selection.md)

## Decision

Mirror retains versions 1 and 2 and registers version 3 for arbitrary planes. Split and body Pattern
retain version 1 and register version 2 alongside it. Old projects retain their original origin-plane,
origin-axis, circular-center, offset, source retention, output role, replay, and content-identity
semantics. Editing existing ordinary parameters preserves the current version; choosing a reference
explicitly creates the corresponding new version. Mirror version 3 retains version 2 length offset
expressions and `preserveSource`; the signed offset follows the selected plane normal, and retaining
the source creates an independent reflected Part through the existing allocation policy.

The domain owns reusable `ReferencePlane` and `ReferenceAxis` contracts. Plane supports are origin
planes, authored Datum Plane frames, stable planar `BodyTopoRef` faces, or explicit world origin and
unit normal. Axis supports are origin axes, a Datum Plane frame's X, Y, or normal axis, stable straight
`BodyTopoRef` edges, or explicit world origin and unit direction. Explicit origins use canonical
millimeters within the existing 100,000 mm workspace. Directions are normalized and nondegenerate.

Dependencies contain the target producer first, followed by the distinct support producer when
needed. A replacing operation consumes only the exact target role. Source-preserving Mirror consumes no
body; supporting geometry remains available.
Stable body topology is persisted in parameters and resolved against the current named body catalog.
Generic aggregate `feature.references` remains empty: dropping an output role would make identical
faces on Pattern siblings ambiguous. Native candidate IDs and mesh indices remain transient picking
evidence. Missing roles, ambiguous topology, unavailable Datum frames, and nonlinear edges fail closed.

The application resolves supports during the ordinary scheduled content-preparation path. Resolved
numeric planes and axes plus an optional dependency input index enter versioned worker content;
document UUIDs do not enter this numeric support binding. The worker validates target role, support
cardinality, normalized direction, and bounded placement before native evaluation. MCP adapters must
use the same registered document command, draft, preparation, preview, and commit path.

Mirror uses OCCT's copied reflection with an arbitrary `gp_Ax2`. Pattern uses copied translation or
rotation about an arbitrary `gp_Ax1`; instance roles and Part allocation policies are unchanged.
Split copies the source into a right-handed plane frame, runs the existing exact two-solid cut, and
copies both results back into world coordinates. Tangential plane-origin displacement does not change
the cut. Temporary local coordinates have a conservative 300,000 mm limit because a world-bounded
solid can have larger coordinates after rotation; published world geometry retains the protocol's
100,000 mm bound. Cleanup failures invalidate the operation and release owned outputs.

## UI and verification

Task panels retain the starting face pick while preview replaces source meshes, resolve it against
current geometry, and provide origin controls, current Datum/geometry options, and explicit
numeric frames. Mirror and Split can bind the current viewport planar-face selection. Invalid explicit
coordinates clear preview and disable Apply. Reference choices do not mutate the document; successful
Apply creates one ordinary command and Undo entry.

Domain tests cover version dispatch, exact dependency ordering and target-only consumption.
Application tests cover current role selection, missing/ambiguous references, and stable line direction
and endpoint anchor after native edge reversal. Native tests cover oblique plane/axis geometry, source preservation,
volume, independent ownership, and failure cleanup. Browser tests exercise exact preview, Apply,
native Save and reopen independently of unit evidence.
