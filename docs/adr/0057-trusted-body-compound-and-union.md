# ADR 0057: Trusted body Compound and Union

Status: Proposed

For feature schema version 2, this decision is superseded by
[ADR-0072](0074-ordered-body-slots-in-compound-and-union.md). Version 1 archives retain the original
distinct-producer contract recorded below.

## Decision

Register separate first-party Compound and Union feature types. Both select two to eight exact named body outputs from distinct producer feature IDs. This explicit MVP restriction preserves the dependency contract in ADR 0049; selecting multiple slots from one producer requires a later dependency-model change.

Compound retains separate solids, including touching or overlapping solids. Each authored slot has a UUID and exposes `body.<slotUUID>`. Reordering slots preserves their output identities and corresponding authored PartIds. Removing a slot makes references to that role unavailable. Current inputs advance their existing PartIds; historical inputs use the captured fork allocation policy in ADR 0054. An unavailable input prevents all slot advances.

Union uses the first input PartId as its surviving part and consumes the remaining selected parts. It must produce one valid positive-volume solid. Disjoint native results fail and preserve available source geometry; authored consumption remains intent under ADR 0054. A selected role without an authored owner makes Union unavailable and prevents advancement and consumption. Changing the ordered selection intentionally changes the surviving PartId. Suppression restores the prior bindings for both operations.

The trusted handlers accept only these bounded, typed body selections. Neither feature accepts arbitrary code, native matrices or unchecked native indices. Canonical content records ordered dependency hashes and roles; Compound additionally records the stable authored output roles.

## Native ownership

Copy each exact input using the rigid transformation copy path from ADR 0055 before building a native compound or fusing solids. Source wrappers and source topology remain unchanged. The existing shape registry owns the root and Compound role wrappers, and resolves cached roles without a second role catalog. Release callbacks remove cached topology metadata only after successful native deletion. Failed native deletion remains retryable; a failed metadata callback must never retry an already freed native wrapper.

## Validation

Acceptance requires real pinned OCCT worker evidence for volume, bounds, exact role catalogs, reorder and dependent rebuild, suppression and missing-role recovery, source isolation, eight-body limits, disjoint Union rejection, and zero owned wrappers after disposal. Domain regressions cover authored PartId continuity, historical forks, suppression and replay independently of native tessellation.
