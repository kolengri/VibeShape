# Print preparation and desktop handoff

Exact CAD validity does not prove wall thickness, support requirements, strength, physical fit, or slicer settings. The current MCP surface does not provide a production printability report, printer profile, toolpath, or G-code.

For a requested printable part, retain the supplied printer/material/nozzle, mating dimensions, and tolerances. If these change the design and are missing, ask before making consequential geometry or slicing choices. Separate nominal model dimensions from physical clearance assumptions and later mount/print evidence.

## Prepared-print copy

The editor's **Export → Prepare print…** creates a disposable derived copy for print preparation. It does not rewrite the saved parametric model. The current slice rotates around X/Y, centers/seats the copy, and can add up to two breakaway fins on suitable sloped planar facets of a validated convex closed body. Unsupported cases retain the transformed copy without fins and report a warning; even supported cases provide partial coverage. Use only the current dialog's requested controls. Preview the prepared copy, identify any added geometry, and keep its file distinguishable from the original export.

Prepared-copy controls are not exposed as MCP tools. Exported 3MF records millimetres; it is not a native Bambu Studio project with an established printer, process, filament, and plate profile. Avoid interpreting geometric preparation as slicing evidence.

## Native desktop handoff

The Mac app's export dialog sends a generated STL or 3MF directly to an installed slicer, with
remembered mesh format and target. Use the detected target or the native application chooser. This
workflow requires no separate bridge process or pairing token. A launch failure preserves the mesh;
use **Show mesh in Finder** for manual recovery. The static browser downloads the same mesh for
manual opening. Discovery, a successful spawn, import, and physical printing are different outcomes.

The legacy authenticated loopback bridge remains an explicit source CLI compatibility workflow,
documented in `docs/3d-printing.md`; it is not required by the product UI. No native slicer-launch MCP
tool is advertised. Use the visible supported handoff within the person's authorization and report
which outcome actually occurred.

When acceptance requires slicing, inspect the actual opened file, scale, orientation, printer/process/filament profile, and requested preview in the chosen slicer. Use an explicitly requested printer/slicer workflow for further operations; this skill itself grants no printer, upload, publication, or paid-service authority.
