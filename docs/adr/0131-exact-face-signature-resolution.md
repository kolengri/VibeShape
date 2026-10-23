# ADR-0131: Exact Face Signature Resolution

- Status: Accepted
- Date: 2026-10-23
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md),
  [ADR-0051](0051-body-bound-topology-inspection.md) and
  [ADR-0120](0120-exact-edge-signature-resolution.md)
- Supersedes ADR-0120's statement that face resolution is unchanged.

## Decision

Apply the existing identical-signature precedence to faces as well as edges. With no explicit
intent hint, exactly one eligible candidate with the identical complete stored signature resolves
before approximate ranking. Compare all fields, including adjacency and normalized optional
direction fields. Duplicate identical signatures remain ambiguous.

Keep semantic roles, history lineage, topology kind, producing feature and named-body scope
authoritative. The exact check runs only inside the already eligible candidate set. Missing or
duplicated authoritative identity never falls through to another face. Explicit intent retains
its existing ranking behavior. Vertex matching, approximate weights, score thresholds and the
confidence margin are unchanged. Native indices remain evaluation-local.

## Reason

A shallow annular groove leaves two coplanar top lands with the same centroid, normal and
adjacency but slightly different areas and bounds. Approximate ranking rejects even the uniquely
identical selected land because its neighbor is too similar. Exact face consumers therefore fail
before the kernel receives an otherwise admissible operation.

Real OCCT regressions first execute Shell and positive Press Pull directly on each selected land,
then exercise the ordinary reference resolver and execute the same operation. Both operations
failed at resolution before this correction, despite valid native results. Separate mesh-to-cold
rebuild tests cover selected Fillet, Chamfer, Shell and Press Pull at three display tolerances.

## Consequences

The shared domain fix applies to existing face-reference consumers without changing file,
feature or protocol schemas. It does not migrate old mesh-inflated references, infer identity
among coincident faces, relax repair requirements or establish lineage across arbitrary edits.
Regressions retain duplicate-signature ambiguity, explicit intent, candidate-order independence,
lineage scope and conservative non-identical matching.
