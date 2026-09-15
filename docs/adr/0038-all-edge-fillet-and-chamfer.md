# ADR-0038: All-edge Fillet and Chamfer

- Status: Accepted
- Date: 2026-09-04
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md)

## Context

The exact kernel can round and bevel solids, but the editor has no persistent Fillet or Chamfer
feature. Selected-edge modeling requires a generalized stable topology selection and repair workflow.
A bounded all-edge operation can deliver useful parametric modeling without persisting transient
OCCT indices or implying selected-edge support.

## Decision

Register separate Fillet and Chamfer schema-version-1 types in the existing Part Design module.
Each consumes exactly one explicit solid dependency and contains no topology references. Fillet owns
one positive length Quantity named `radius`; Chamfer owns one named `distance`. Both retain authored
unit and variable expressions through the ordinary feature add/update commands.

Version 1 means every edge of the evaluated target. Upstream edits can therefore change the set of
edges affected. Selected-edge intent, propagation, variable radii, asymmetric chamfers, and topology
repair must use a later explicit contract rather than changing the meaning of version 1.

The geometry worker owns exact B-Rep construction, temporary native objects, validation, and disposal.
A successful result contains exactly one valid positive-volume solid. Missing or non-solid targets,
invalid dimensions, kernel failure, and invalid results fail closed. The target remains available
for rebuild and recovery. The resulting feature consumes its target in terminal-body selection.

The editor exposes named Fillet and Chamfer commands with a target selector and variable-aware size
field. It shows an explicit all-edges scope, evaluates a disposable worker preview, and permits
submission only after the latest preview succeeds. Cancel discards the preview; Apply saves one
ordinary feature command. Editing and export use the existing document authority and storage format.
Committed document undo remains a separate unfinished platform capability.

## Consequences

- No package, additional CAD authority, persisted mesh identity, or file-format migration is added.
- Existing models remain readable; the new registered feature types use the versioned feature record.
- Downstream modifying operations can consume the result as one solid.
- The initial UI excludes multi-profile New results, because individually addressable solid identity
  remains undefined.
- MCP can later map explicit tools to these feature schemas, but this change does not implement MCP.

## Verification

Require parameter and dependency contract tests, exact worker shape invariants and failure coverage,
and browser create/preview/cancel/edit/reopen/export coverage. Check native ownership on success and
failure, including repeated evaluation and document disposal.
