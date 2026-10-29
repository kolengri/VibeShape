# ADR-0140: Automatic Print Topology Optimization

- Status: Accepted with reduced scope
- Date: 2026-10-29
- Extends: [ADR-0101](0101-browser-structural-lightweighting.md), [ADR-0108](0108-generative-design-fdm-constraints.md), [ADR-0122](0122-density-topology-and-adaptive-lattices.md)

## Decision

Extend the existing structural numerical owner with a print-oriented setup workflow, compound
load patterns, and optional per-case baseline-relative performance gates. The default
Lightweighting command opens this workflow; explicit service supports and loads remain available
through the manual task. No new solver, runtime, dependency, document feature, or import authority
is introduced.

The user selects a planar supporting bed face, a printed-plastic example or custom isotropic
properties, and optional faces whose nearby material must remain. The exterior may otherwise
change inside the original design envelope. Rotate the captured source into print coordinates,
preserving triangle order, with the selected outward normal toward -Z. Reject nonplanar faces and
selections that place source geometry below the bed. FDM remains axis-based in this frame. Restore
the validated result to its source placement before ordinary preview and atomic mesh import.

Automatic scenarios assume a clamped slab at one end of the longest print-frame bounding-box
span. The opposite end receives normalized axial tension, two transverse bending cases, and a
combined opposing-force couple. The print-bed face is not the mechanical support. Each compound
case assembles all traction terms into one right-hand side; every interface is independently
validated and retained. Geometry that cannot resolve separated interfaces fails explicitly.

Filtered SIMP targets the lowest admitted volume fraction, then tests increasing binary retained
volumes in density order. Acceptance requires every case's compliance to stay within its baseline
compliance divided by the requested retained-stiffness fraction, and its peak von Mises stress to
stay within its baseline stress divided by the requested retained-strength fraction. Both defaults
are 0.9. Existing absolute, connectivity, small-strain, FDM, final solid and serialization checks
remain authoritative. The independent client validates echoed fractions and every case. A baseline
fallback cannot be applied as an improvement.

If a relaxed SIMP density solve fails numerical verification, stop density iteration and report it
explicitly. Binary reconstruction uses the last verified density ranking, or baseline FEM energy
when the first density solve fails. Only this fallback path uses budgeted geometric retained-count
spacing to include high-density, small-removal candidates. Attempted density solves remain counted
in numerical evidence; convergence stays false. Every accepted binary candidate still passes the
unchanged equilibrium and performance gates, followed by repeated final verification.

## Alternatives and consequences

Inferring actual service loads from shape would hide unsupported assumptions. Requiring service
loads before every run would prevent the requested simple workflow. Explicitly labeled normalized
scenarios permit reproducible comparative optimization while retaining the manual workflow for
actual use conditions. Opposing forces on irregular patches can also produce bending; the scenario
is a standardized couple rather than a certified pure torque.

A full orthotropic material model and slicer-backed search would better represent layer adhesion,
infill and toolpaths, but require new material evidence and numerical/manufacturing validation.
This delivery retains isotropic linear elasticity: print orientation affects manufacturing checks,
not directional elasticity. The mass/performance tradeoff is explicit and editable; neither a
global minimum mass nor maximum strength under arbitrary service loading is claimed.

Results remain unsmoothed voxel mesh snapshots, without exact CAD reconstruction or STEP output.
Preservation retains resolved nearby cells rather than exact mating surfaces. Exported coordinates
remain in the original model placement; print preparation must reproduce the selected orientation.
Reports retain the source-to-print transform and normalized-scenario provenance. The editor setup
helper is not a new MCP command: paired transports share the compound-load and relative-performance
contracts through their existing explicit structural settings.
