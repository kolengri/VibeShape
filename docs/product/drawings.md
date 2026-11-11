# Engineering drawings

**Create Drawing** turns the committed model into a dimensioned 2D sheet. It is available from
Model → Inspect, the command palette and the application menu (**Create Drawing…**). Drawings are
derived output: creating or downloading one never edits the project, adds History or Undo entries,
or changes the `.vshape` file. See [ADR-0160](../adr/0160-derived-engineering-drawings.md).

## Dialog

| Setting | Choices |
|---|---|
| Parts | All parts, or one Part with an exact solid body (shown when the model has several) |
| Views | Front, Back, Top, Bottom, Right, Left, Isometric; at least one stays selected |
| Projection | First angle (ISO) or Third angle (ANSI) |
| Sheet size | ISO A4, A3, A2, A1, A0, US Letter, US Tabloid |
| Orientation | Landscape or Portrait |
| Scale | Fit to sheet (largest ISO 5455 scale that fits) or an explicit standard ratio |
| Dimension units | Millimeters or Inches (geometry stays in millimeters) |
| Hidden lines | Dashed hidden edges in orthographic views |
| Dimensions | Overall width and height per orthographic view, diameter callouts for visible holes and bosses |
| Title block | Title (empty uses the project name), drawing number, author, date, material |

The preview is the exact SVG that **Download SVG** saves. Projection runs once per model
revision, Part and view set; sheet, scale, units and title changes update the preview immediately.
When an explicit scale does not fit, the preview says so and still shows the overflowing sheet.
Settings are remembered for each project on the current device.

## Output

- **SVG**: vector sheet in millimeters; line types and weights come from CSS classes.
- **DXF**: AutoCAD R12 ASCII at sheet scale in millimeters with VISIBLE, HIDDEN, DIMENSIONS, TITLE
  and FRAME layers. Lines, circles and arcs are exact.
- **PDF**: one vector page using the standard Helvetica font.

Identical model and settings produce identical files. Files are named `<project> drawing.<ext>`.

## Geometry

Views come from exact OCCT hidden-line removal, not from the display mesh. Straight edges, circles
and arcs keep their exact geometry; other curves are sampled within 0.01 mm. Hidden edges are
dashed only where no visible edge covers them, including partial overlaps. Mesh parts cannot be
drawn: **All parts** draws the solid parts and skips meshes, and the Part choice stays available
whenever the model contains mesh parts.

## Automation

`prepare_drawing_export` on local and paired remote MCP prepares the same files for the exact
committed revision; see the [operator reference](../../.agents/skills/vibeshape-export/references/drawings.md).

## Limits

Manual dimensions, section and detail views, moving views, tolerances and GD&T, multiple sheets,
embedded PDF fonts (characters outside WinAnsi print as `?` on the PDF page), DXF line weights,
characters beyond the Basic Multilingual Plane in DXF (written as `?`) and drawings saved inside
the project are not available.
