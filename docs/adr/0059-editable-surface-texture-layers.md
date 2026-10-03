# ADR-0059: Editable surface texture layers

- Status: Accepted
- Date: 2026-10-03
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md),
  [ADR-0006](0006-3mf-primary-print-export.md),
  [ADR-0039](0039-committed-document-undo.md), and
  [ADR-0054](0054-authored-parts-and-organizational-history-folders.md)

## Decision

Author surface relief as ordered, non-destructive texture layers alongside the parametric model.
Document authority version 3 adds `surfaceTextures`; frozen V0, V1, and V2 schemas and reducers keep
their existing contracts. Each layer has a UUIDv7 ID, producing feature ID, explicit body output
role, enabled state, map, projection, displacement settings, blend mode, and optional painted region
expressed by its mask. Whole-body targets use the semantic output role. Selected-face targets use
body-scoped schema-version-1 `BodyTopoRef` records. Transient tessellation face IDs are resolved afresh
from the exact current rebuild and never persisted. Missing or ambiguous references require repair;
they cannot select the nearest available surface or another output role.

The initial maps are deterministic Noise, Ridges, Dots, Knurling, Hexagons, and Wood, plus images
converted locally to grayscale. Mapping supports triplanar, planar, cylindrical, and spherical
projections with an explicit axis, U/V size and offset in millimeters, and rotation in degrees.
Height, outward/inward/centered direction, inversion, boundary fade, and ordered `add` or `replace`
blending remain editable intent. Bounds are four layers per feature, 256 by 256 grayscale pixels per
custom map, and 2,048 paint/erase dabs per mask. Dabs retain finite model-coordinate centers,
normalized normals, radius, and hardness; normal compatibility prevents painting the opposite
surface through a body. Masks start with either the whole target or an empty region.

Preview is disposable worker output. Apply replaces the target feature's reviewed layer collection
in one revision-guarded, lease-checked command and one Undo boundary. The first texture Apply upgrades
V2 authority and stores those layers in the same event. Undo may lift the preceding V2 revision to V3
with an empty texture collection; it never downgrades the authority head. Feature removal prunes its
layers atomically, and Undo restores the feature and layers together. Ordinary model and metadata
edits retain texture authority. Existing paired metadata automation remains available; this increment
adds no external texture-authoring command.

## Geometry and export

The source B-Rep, feature parameters, and exact STEP export remain unchanged. The worker derives a
refined displacement mesh for the viewport and for STL/3MF manufacturing export. Sharp CAD joins stay
fixed to avoid folds caused by averaged normals. Zero-area analytic pole or seam triangles may be
removed only when the remaining mesh proves positive volume and a closed, consistently oriented
manifold. Resource limits, missing target faces, open/reversed seams, and detected collapsed or folded
triangles fail with actionable diagnostics. Preview quality is disposable and does not replace the
source geometry or manufacturing evidence.

These checks do not prove absence of global self-intersections, minimum wall thickness, physical fit,
strength, slicer acceptance, or print success. Those claims require separate geometry analysis,
interoperability, and physical evidence.

## Persistence and compatibility

Native archive format 4 retains the five-entry layout and adds explicit texture-upgrade provenance.
The V3 snapshot and complete mixed journal must pass strict schema, digest, resource-limit, and replay
checks. Complete copies remap document, command, and transaction IDs while preserving local layer,
feature, part, and folder identities. Checkpoint archives remain read-only. The latest authored reader
dispatches formats 0 through 4; older codecs reject unsupported versions. Existing IndexedDB tables
hold explicit V1/V2/V3 record variants, and recovery cannot silently fall back across the newest
recorded authority boundary.

No runtime dependency or project-license change is introduced. Edge-split cases retain attribution
in the engine source to the historical GPL-3.0-only stlTexturizer commit
`eedb131588c38d11010e86b022de76af414827a6`; the current upstream core is not imported.

## Evidence boundary

Domain, application, persistence, and format tests cover first Apply, Undo/Redo, complete copy, native
round-trip, checksum corruption, bounds, and semantic target refusal. Real OCCT cube, sphere, and
cylinder fixtures plus independently parsed STL/3MF exports provide digital mesh evidence. Chromium,
Firefox, and WebKit workflows verify Apply, Undo/Redo, browser reopen, STL relief, local image
persistence, original-surface brush picking, stroke cancellation, and hidden-target refusal. Physical
print validation remains separate acceptance work.
