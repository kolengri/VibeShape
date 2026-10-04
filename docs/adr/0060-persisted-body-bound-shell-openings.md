# ADR 0058: Persisted body-bound Shell openings

Status: Accepted; version-2 authoring superseded by [ADR-0076](0076-closed-shells-and-durable-opening-identity.md)

## Context

[ADR 0051](0051-body-bound-topology-inspection.md) introduces BodyTopoRef v1 for exact named-body inspection and requires an explicit consumer contract before persistence. Shell needs selected opening faces without storing transient OCCT indices or silently rebinding changed geometry. Its native offset builder must preserve all cached dependency shapes.

## Decision

The trusted `org.vibeshape.feature.part-design.shell` schema version 1 owns one exact `targetBody`, positive length `thickness`, explicit `inward` or `outward` direction, a selected `sourceContentHash`, and 1–64 BodyTopoRef v1 face `openings`. Every opening feature and output role must match the sole dependency. Generic feature references remain version 0 and are empty for Shell; this does not widen other consumers.

Canonical parameters contain numeric thickness, direction, source hash, and sorted opening content without document-local feature UUIDs. Ordered content input roles must identify the same exact body. The worker checks the source hash and role before native allocation. Resolution uses only that body's complete face catalog, rejects missing or ambiguous results, verifies the unchanged signature even after semantic/history resolution, and rejects duplicates. Any changed source content requires explicit reselection in the edit UI. No automatic repair occurs.

The native implementation deep-copies the source through an identity `BRepBuilderAPI_Transform` with copy enabled and maps opening faces through its `ModifiedShape` history. `MakeThickSolidByJoin` receives only the owned copy and mapped opening faces. Inward uses a negative offset, outward a positive offset, with intersection joins. All acquired native wrappers are disposed; the adopted result alone enters the owned feature cache. Results must contain one valid positive-volume solid.

Shell advances the existing authored PartId and retains source history under the established modifying operation contract. Preview, Apply, Cancel, update, undo/redo, native archives, reopen, and export use the ordinary document path. The opening catalog provides area and centroid measurements and supports explicit repair without viewport changes.

## Consequences

Version 1 is deliberately conservative: even a source-content edit that preserves apparent face geometry requires reselection. Native offset limitations remain explicit failed geometry results. This avoids inferring intent from coincident faces and leaves a future repair policy to its own versioned contract.

Domain/schema tests cover body scope and canonical identity; native failure tests cover ownership; the real pinned kernel corpus covers inward/outward volumes and bounds, multiple openings, source preservation, stale/changed rejection, repair, and STEP/STL export. UI acceptance verifies authored identity, persistence and explicit repair through current revision evidence.
