# ADR-0003: Feature DAG and Stable TopoRef

- Status: **Accepted**
- Date: 2026-08-07

## Decision

Store design intent as a directed acyclic graph of parametric features. References to faces, edges, and vertices include the producing feature, semantic or history lineage, geometric and adjacency signatures, and intent hints.

An uncertain match returns `ambiguous` and requires repair. Selecting the nearest candidate without a sufficient confidence margin is forbidden.

## Consequences

- More foundational work is required before adding a broad feature set.
- The reference format becomes part of the native schema.
- Datum and origin references are preferred.
- Property-based parameter and topology tests are a release gate.
- The system explicitly identifies rebuilds that require user intervention.
