# Prepare an engineering drawing

Use `prepare_drawing_export` on local or paired remote MCP with the exact committed `revision` and
`format: "svg" | "dxf" | "pdf"`. It is read-only: it projects the committed terminal solids with
exact hidden-line removal, composes one sheet and writes it, without a draft, History entry, Undo
entry, filesystem write, browser download or saved setting.

Without `partId` the drawing contains every exact terminal body and silently skips triangle-mesh
parts. Optional `partId` limits it to one authored Part; obtain it from `model_parts`. Failures:

| Code | Retry | Meaning |
|---|---|---|
| `part-not-found` | No | `partId` does not name a Part with a body at that revision; read `model_parts` again |
| `no-drawable-bodies` | No | The selected Part is a triangle mesh, or the model has no exact body |
| `drawing-too-complex` | No | A view exceeds the projected edge or curve-sample budget; draw fewer parts or views |
| `stale-revision` | Yes | The revision is stale, changed while projecting or the session was replaced; read the current revision and prepare again |
| `drawing-failed` | Kernel flag | Other projection failures |

Optional `settings` accepts:

| Field | Default | Values |
|---|---|---|
| `views` | `["front", "top", "right", "isometric"]` | Unique subset of front, back, top, bottom, right, left, isometric |
| `projection` | `"first-angle"` | `"first-angle"` or `"third-angle"` |
| `sheetSize` | `"iso-a3"` | `iso-a4`, `iso-a3`, `iso-a2`, `iso-a1`, `iso-a0`, `us-letter`, `us-tabloid` |
| `orientation` | `"landscape"` | `"landscape"` or `"portrait"` |
| `scale` | `{ "mode": "auto" }` | Or `{ "mode": "explicit", "numerator", "denominator" }`, integers 1–1000 |
| `units` | `"mm"` | `"mm"` or `"in"` for dimension text only |
| `hiddenLines` | `true` | Dashed hidden edges in orthographic views |
| `dimensions` | `true` | Overall dimensions and diameter callouts |
| `titleBlock` | empty strings | `title` (≤80, empty uses the project name), `drawingNumber` (≤40), `author` (≤60), `date` (≤20), `material` (≤60); control characters are rejected |

Front looks along +Y with Z up, top looks down −Z with Y up, right looks along −X; the isometric
view is seen from +X, −Y, +Z. Automatic scale picks the largest ISO 5455 scale that fits; an
explicit scale that overflows still produces a sheet, so prefer auto unless a ratio is required.

The result is the ordinary actor-bound descriptor: `drawing.svg` (`image/svg+xml`), `drawing.dxf`
(`image/vnd.dxf`) or `drawing.pdf` (`application/pdf`), with document, revision, byte length,
SHA-256 and five-minute expiry. Fetch with `read_export_chunk`, verify length and hash, then
`discard_export`. Files are limited to 6 MiB. DXF is AutoCAD R12 at sheet scale in millimetres
with VISIBLE, HIDDEN, DIMENSIONS, TITLE and FRAME layers; PDF uses standard Helvetica, so
characters outside WinAnsi print as `?`. Sheet labels are English.

Drawings are derived: they are not saved in the project and do not stay associative after a model
edit. Prepare a new file for each revision. Manual dimensions, section views and GD&T are not
available.
