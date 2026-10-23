# ADR-0120: Exact Edge Signature Resolution

- Status: Accepted
- Face-resolution scope superseded by [ADR-0131](0131-exact-face-signature-resolution.md).
- Date: 2026-10-21
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md) and [ADR-0040](0040-selected-edge-treatments.md)

## Decision

Before approximate signature ranking, resolve an edge with no explicit intent hint when exactly one
eligible candidate has the identical complete stored signature. Compare every signature field,
including adjacency; do not persist evaluation-local candidate IDs or native edge indices.
Duplicated identical signatures remain ambiguous. An explicit semantic role or lineage still
restricts eligible candidates and fails closed when missing. Explicit intent retains its existing
ranking behavior. Face and vertex resolution are unchanged.

## Reason

Thin circular parts can have two nearby rims with very similar lengths, bounds and centroids.
The normalized confidence margin previously rejected even a uniquely identical freshly picked rim.
Requiring that same margin for an identical signature prevents both ordinary selection and repair.
Identical evidence can identify that rim without changing approximate matching tolerances.

## Consequences

The same domain resolver serves viewport selection, feature validation and MCP-authored treatments.
No native-file or protocol schema changes are required. Changed geometry without an identical
signature retains conservative threshold and confidence checks. This does not establish general
topological identity for coincident edges or lineage across arbitrary upstream edits.

Regression evidence covers differently sized neighboring circles, reordered candidate lists,
duplicate identical candidates, non-identical ambiguous candidates, and both exact OCCT Fillet and
Chamfer operations on a thin cylinder while preserving the source solid.
