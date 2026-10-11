# ADR-0108: Conservative FDM Constraints for Generative Design

- Status: Accepted with reduced scope
- Date: 2026-10-11
- Extends: [ADR-0107](0107-bounded-generative-design-studies.md)
- Related: [ADR-0101](0101-browser-structural-lightweighting.md)

## Decision

Extend the existing structural domain settings, numerical worker, and Generative Design task with
optional bounded FDM constraints. The editor study exposes both **Without supports** and
**Supports allowed** policies, six model-axis build directions, minimum feature size, layer height,
and an overhang limit explicitly measured from vertical. No new computational package, dependency,
document feature, printer traffic, or slicer execution is introduced.

The minimum feature constraint applies in both policies. The support-free policy additionally
rejects unsupported geometry during removal and repeated final verification. The supports-allowed
policy retains unsupported-area evidence for comparison; it does not generate supports. Requests
and results bind the complete FDM settings through the same shared verification contract used by
the numerical client and paired MCP. Legacy structural analyses omit these settings and keep their
existing behavior.

## Alternatives and consequences

A slicer-backed search could compare actual toolpaths and support volume, but would add a local
process boundary, profile ownership, and slicer-version dependencies. A surface-based manufacturing
optimizer could produce smoother overhangs but would require a different numerical/reconstruction
contract. Conservative checks on the exact analyzed voxel cells keep computation inside the
existing browser worker, with explicit discretization and resource limits.

Minimum feature size is a conservative filled-cube bound, not a nozzle/perimeter simulation.
Stepped voxel surfaces can be rejected even when a calibrated printer could bridge them. The
selected direction defines analysis relative to the bed; the snapshot keeps model coordinates and
ordinary export does not rotate it. Slicer preparation must reproduce the selected orientation.
Isotropic FEM does not gain layer-direction strength or infill modeling from this feature.

Canonical behavior and limitations belong to
[Generative Design](../product/generative-design.md#fdm-constraints).
