# Print preparation and desktop handoff

Exact CAD validity does not prove wall thickness, support requirements, strength, physical fit, or slicer settings. The current MCP surface does not provide a production printability report, printer profile, toolpath, or G-code.

For a requested printable part, retain the supplied printer/material/nozzle, mating dimensions, and tolerances. If these change the design and are missing, ask before making consequential geometry or slicing choices. Separate nominal model dimensions from physical clearance assumptions and later mount/print evidence.

## Prepared-print copy

The editor's **Export → Prepare print / breakaway fins…** creates a disposable derived copy for print preparation. It does not rewrite the saved parametric model. The current slice rotates around X/Y, centers/seats the copy, and can add up to two breakaway fins on suitable sloped planar facets of a validated convex closed body. Unsupported cases retain the transformed copy without fins and report a warning; even supported cases provide partial coverage. Use only the current dialog's requested controls. Preview the prepared copy, identify any added geometry, and keep its file distinguishable from the original export.

Prepared-copy controls are not exposed as MCP tools. Exported 3MF records millimetres; it is not a native Bambu Studio project with an established printer, process, filament, and plate profile. Avoid interpreting geometric preparation as slicing evidence.

## Desktop bridge

VibeShape's optional authenticated loopback bridge can hand a generated 3MF to an allowlisted installed slicer. Source setup, when requested, is documented in the repository's `docs/3d-printing.md`. Pair the exact editor origin; localhost and 127.0.0.1 are different origins. Keep the credential private and use the visible bridge setup controls.

The bridge receives a bounded temporary 3MF and launches OrcaSlicer, Bambu Studio, PrusaSlicer, Snapmaker Orca, or UltiMaker Cura. It does not choose a printer profile, slice, generate G-code, or print. If unavailable, the editor downloads the same 3MF and reports fallback. Verify which outcome occurred before reporting handoff.

When acceptance requires slicing, inspect the actual opened file, scale, orientation, printer/process/filament profile, and requested preview in the chosen slicer. Use an explicitly requested printer/slicer workflow for further operations; this skill itself grants no printer, upload, publication, or paid-service authority.
