# ADR-0083: Exact-body Revolve and Subtract

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0030](0030-explicit-target-revolve-operations.md), [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md), and [ADR-0051](0051-body-bound-topology-inspection.md)

## Decision

Register modifying Revolve version 7 and Subtract version 2 beside their existing versions.
Persist exact `BodyReference` selectors: Revolve has `targetBody`; Subtract has ordered
`targetBody` and `toolBody`. References identify a producer and stable output role, never a
native solid index. Old records retain their original schemas, whole-result behavior, replay,
and content identity.

Revolve retains the bounded same-sketch profile set, typed angle expressions, and existing origin,
sketch-line, and stable model-edge axes. Only Add, Remove, and Intersect use version 7; New remains
on its existing contracts. Dependencies contain the target first, then distinct sketch support
and model-edge axis owners. Canonical content projects the target output role into input 0;
profile materialization and OCCT Fuse/Cut/Common reuse the existing worker path. Only the selected
target body advances its Part binding. Supporting bodies and sibling outputs remain available.

Subtract permits two different roles from the same producer. Its dependencies contain each
producer once in target/tool first-occurrence order. Canonical identity uses the existing version-2
ordered body slots, retaining both roles even when they share an input hash. UUID selectors and
`keepTools` are excluded from numerical geometry identity. Both selected shapes are copied and
resolved before evaluation or a B-Rep cache hit. Tool retention changes authored Part consumption,
not the cut: the target always advances; the tool is consumed unless `keepTools` is true. Siblings
retain their Part identities. Missing roles fail closed without aggregate fallback.

## Authoring and verification

Task panels offer current valid single-solid bodies, exclude later History during edit, and retain
saved exact input selections. Distinct roles of one producer remain separate choices. Preview,
Apply, undo/replay, suppression, and persistence use ordinary registered document commands.
Legacy form interfaces remain compatible for existing whole-producer callers.
Editing an existing legacy modifier retains its whole-producer choice, including a multi-solid
aggregate, and its original single- or multi-profile schema. Selecting an exact role explicitly
opts into the new contract; merely opening and applying an existing feature does not migrate it.

The additive named `create_body_revolve`/`update_body_revolve` and
`create_body_subtract`/`update_body_subtract` MCP tools use those same authored commands and owned
draft authority. Their strict contracts reject caller actor/document/content-hash fields,
self-dependencies, and inconsistent producer ordering. Existing tool names preserve their versions.
Local and paired remote transports share the contracts; discovery remains authoritative.
The server-generated remote tool catalog has a separate 2 MiB response cap. The integrated
80-tool catalog measures 1,061,904 UTF-8 bytes; ordinary browser operation and result limits remain
unchanged. This cap does not grant larger caller payloads or authored operations.

Tests cover strict version dispatch, slot identity and ordering, retention-independent geometry,
Part continuation and replay, suppression, exact role selection, and unchanged legacy interfaces.
Pinned OCCT checks compare analytical volume and bounds for all three Revolve operations and
ordered Subtract, preserve source/sibling shapes, reject unavailable inputs, and return owned
shape counts to zero after document disposal. Real browser/MCP checks validate scheduled sketch
preparation, preview repair, ordinary review/Apply, and reload separately from unit evidence.
