# Local component library

Library opens from the application bar in Model or Assembly mode. Browse local items by name and
tags, then choose an explicit numbered version. Reading verifies its frozen semantic closure and
required source bytes; a missing or corrupt version reports an error instead of selecting another
version or substitute geometry. No cloud library or remote upload is used.

Save a frozen component accepts an available authored Part or an existing frozen assembly
definition. Enter its name and comma-separated tags, then create a new item or explicitly publish a
new version of the selected item. The controller rebuilds and verifies the selected source before
publication. Existing content versions remain immutable. Name and tag changes use optimistic
metadata revisions; stale writes require a refresh. Library publication and metadata edits are local
library side effects and create no CAD Undo step.

Insert copy creates an independently owned frozen definition and grounded occurrence. Insert
pinned reference additionally stores the selected item UUID and numbered version. Both retain
their captured source closure and use one ordinary CAD transaction. Editing the live source or
publishing a new library version changes neither insertion automatically. Choose a verified version
and use Update reference to explicitly relink an existing pinned definition while keeping its
occurrence identities. Detach library reference removes only its binding, preserving frozen
geometry, the definition and its occurrences. Insert, Update and Detach use ordinary CAD Undo/Redo
and portable native Save/Open.

Pending writes prevent duplicate activation and dismissal, expose accessible pending state, and
release controls after failures. Browsing remains available during a blocked document task;
publication and CAD changes require a writable, available document. Asynchronous results remain
bound to their captured document scope. Search and version reads discard superseded responses;
the UI does not retain source byte blobs.

See [ADR-0073](../adr/0073-immutable-local-assembly-library.md) for source authority, immutable
versioning and storage budgets, and [ADR-0069](../adr/0069-frozen-assembly-source-authority.md) for
assembly pin semantics. Component tests and storage proofs are separate from product browser,
native geometry and integrated review acceptance. The library makes no physical fit or
manufacturing claim.
