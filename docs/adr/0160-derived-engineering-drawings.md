# ADR-0160: Derived 2D engineering drawings with exact hidden-line removal

- Status: Accepted
- Date: 2026-11-11

## Context

Drawings were a P2 gap. Users need dimensioned 2D sheets of committed parts for review, workshop
use and exchange with drafting tools. The bundled replicad-opencascadejs 0.23.0 WASM binds the
exact `HLRBRep_Algo` and `HLRBRep_HLRToShape` hidden-line algorithms, but not the polygonal
`HLRBRep_PolyAlgo`. The repository already writes 3MF, STL, STEP, glTF and OBJ, reads SVG and
DXF sketches, and delivers derived pictures through the actor-bound binary export transport
(ADR-0147). It has no 2D writer.

## Decision

### Boundaries

Drawings extend existing owners; no package or extension seam is created.

| Owner | Contract |
|---|---|
| `@vibeshape/protocol` `drawing-projection` | View identifiers and frames, projected curve/edge/view schemas, chordal tolerance and budgets; the document-worker `projectDrawing` request and `drawingProjected` response (document protocol 29) |
| `@vibeshape/geometry-worker` | `projectOcctDrawingViews` runs HLR per view and releases every native temporary; `projectDrawing` on the engine resolves the exact feature shapes |
| `@vibeshape/document-worker` | Selects the same terminal bodies as export; without a selection skips mesh bodies, otherwise rejects them; rejects stale revisions |
| `@vibeshape/application` | `PersistentDocumentSession.projectDrawing` serializes projection with exports |
| `@vibeshape/domain` `drawing` | Settings, sheet sizes, ISO 5455 scales and the per-document preset schema |
| `@vibeshape/formats` `drawing` | Pure sheet composition (layout, dimensions, callouts, title block) and SVG, DXF and PDF writers |
| `apps/web` `features/drawing` | Create Drawing dialog, preview and preset storage |
| `@vibeshape/automation-api` | `prepare_drawing_export`, read-only, through the existing chunked binary export transport |

Protocol and domain stay dependency-free, so the seven-view list is declared in both and a format
test keeps them equal. Formats gains a dependency on protocol for the projection types.

### Projection

Each view projects the compound of selected terminal solids with `HLRAlgo_Projector` on a
`gp_Ax2` whose normal points toward the viewer: front looks along +Y, top along −Z, right along −X,
their opposites, and an isometric view from (+X, −Y, +Z). Visible and hidden sharp (`VCompound`),
smooth (`Rg1Line`) and outline/silhouette (`OutLine`) compounds are extracted; the isometric view
extracts only the visible ones. Sewn (`RgNLine`) and isoparametric lines are not drawing edges. `BRepLib.BuildCurves3d` gives every 2D result edge a
curve; lines and circles keep exact geometry (full circles and counter-clockwise arcs), straight
sampled curves become lines, and other curves (ellipses, B-splines) become polylines sampled with
`GCPnts_TangentialDeflection` at 0.01 mm chordal and 0.05 rad angular deflection. Every sample is
kept: a curve longer than 4096 points becomes chained polylines sharing end points, and a curve that
needs more than 65,536 samples fails the projection instead of being thinned. A view holds at most
50,000 edges. Exceeding either budget is a deterministic, non-retryable `drawing-too-complex`
failure. HLR also reports hidden copies of edges lying exactly behind visible ones and repeats
shared edges. An indexed coverage pass compares collinear lines and concentric equal-radius
circles and arcs within 1e-4 mm: it merges the parameter or angular intervals of visible curves
(and of hidden curves already kept) and emits only the uncovered pieces of each curve, so a hidden
edge partly behind visible edges keeps exactly its hidden gaps. Collinearity is checked both ways,
so a short tilted segment on a long covering line is covered too. Sampled polylines use continuous
coverage along their arc length: each segment is clipped analytically against the capsules (the
covering piece swept by a disc) of nearby lines, polyline segments and circle/arc chords, with a
radius of twice the chordal tolerance plus 1e-4 mm because two samplings of the same curve each
stay within the chordal tolerance of it. Only near-parallel covering pieces count: every chord, of
HLR and of the cleanup alike, stays within the 0.05 rad angular tolerance of its curve's tangent,
so two samplings of one curve differ by at most 0.1 rad where they overlap, and a piece turned more
than 0.12 rad (about 7°) crosses the curve and cuts nothing however long it stays within the
radius. A sign change of the signed distance cannot classify crossings here, because two samplings
of one curve cross each other at every chord. Covered stretches are merged across vertices;
stretches no longer than four radii only graze the curve and cut nothing; uncovered runs reuse the
original vertices and runs no longer than one radius are dropped. Lines, polyline segments,
circles and arcs live in an adaptive quadtree: a leaf splits above 24 entries unless that would
copy most of them into several children (some child keeps more than 75 % and the children hold
more than 1.5 times the entries), so a lopsided split caused by insertion order still separates
them. Straight pieces are registered in the leaves within the radius of them, circles and arcs in
the leaves their band of that radius crosses. A circle or arc is chorded only when a sampled
curve's query first reaches it, once per cleanup for all indexes, and a query takes only the chords
facing the queried segment, so views of many circles and no sampled curves never build chords.
Circles and arcs are also keyed by centre for the concentric test. The work is proportional to the
covering pieces actually within tolerance; where many sampled curves run within tolerance of each
other in one spot those pairs are all genuine candidates, and the 50,000-edge view budget bounds
them. Unit tests bound leaf entries scanned, pieces handed to clipping and chord builds by counters,
not wall time.
Output contains only coordinates, never OCCT
indices.

Drawings and geometry exports only use geometry of the captured revision: before projecting, the
document report must be at that revision and its rebuild must have succeeded (a lagging report is
a retryable `stale-revision`, a failed rebuild a final `rebuild-failed`), and the revision the
worker actually projected or exported, which is its last successful rebuild, must equal it.
MCP model exports (`prepare_model_export`, `export_model`) report the same `rebuild-failed` and
`stale-revision` codes instead of a generic retryable `export-failed`.

Without an explicit body selection the projection draws every exact terminal body and skips
triangle meshes, failing only when none remains; an explicit selection containing a mesh fails.
Title-block fields reject C0 control characters, DEL and the code points XML 1.0 excludes
(U+FFFE, U+FFFF and unpaired surrogates); the same rule strips them from external text such as
the document-name fallback and from every SVG text node.

### Sheet

Sheets use ISO A4–A0 or US Letter/Tabloid in either orientation, a 10 mm frame and a 180 × 32 mm
ISO 7200-style title block. Orthographic views occupy projection-aligned cells: first-angle
places top below and right to the left of front; third-angle places top above and right to the
right. Views sharing a column or row share one coordinate mapping, so features line up. The
isometric view takes the free corner cell that leaves the largest scale. Each view reserves the
measured extents of its own annotations (dimension rows, callouts and label, with Helvetica text
boxes) beyond its rectangle, and neighbouring envelopes keep 6 mm apart. Automatic scale picks the
largest ISO 5455 scale whose arrangement, annotations included, fits the area above the title block;
an explicit ratio is honoured and reported as not fitting when any annotation would leave that area.
Each orthographic view gets overall width and height dimensions; a value longer than the space
between its extension lines goes outside, beyond the far extension line on an extended dimension
line, with both arrows outside pointing in (ISO 129-1), so thin parts never strike their thickness
through. It also gets one diameter callout per
distinct visible full-circle diameter (`n× Ø d` when repeated, at most eight). Callouts are placed
after the dimensions and view label, greedily in a fixed order (by centre, then radius, so
concentric rings are placed in turn). Each tries five leader shelves (8 to 28 mm) in four
directions and takes the first that stays readable: its label and shoulder keep 0.5 mm clear of
every text and line box placed so far; its label crosses no earlier leader and no drawn circle or
line piece of the view (lines, polyline segments and arc chords, looked up in a grid built once
per projected view; hidden edges count while hidden lines are drawn); and its leader passes
through no placed text. Callouts beyond the
eight largest diameters, and callouts that fit nowhere, are omitted and counted, never drawn over
other text or lines; the dialog reports the count. Clearance measures
the final placed boxes, so scale choice and `fits` include callouts. Isometric views omit
hidden lines. Sheet text is supplied by the host from the localized catalog; MCP output uses the
English source catalog.

### Formats

- SVG 1.1 in millimetres with CSS classes per layer: visible 0.5 mm, hidden 0.25 mm dashed 3/1.5,
  dimension 0.18 mm, title 0.35 mm, frame 0.7 mm; one group per view, dimensions, labels and title
  block.
- DXF AutoCAD R12 (AC1009) ASCII at sheet scale in millimetres with layers VISIBLE, HIDDEN
  (HIDDEN line type), DIMENSIONS, TITLE and FRAME. Lines, circles and arcs stay exact; arrows are
  SOLID entities. Text writes `%%%` only for a `%` next to another `%` or before a generated `%%c` (a lone
  `%` stays literal for readers that ignore control codes), writes `\` as `\U+005C` only before
  `U+` or `M+`, writes Ø as `%%c`, writes group 40 as the Helvetica cap height (0.718 em) because
  DXF text height is a cap height, other
  non-ASCII characters as `\U+XXXX` and characters beyond the Basic Multilingual Plane as `?`. R12
  cannot carry line weights.
- PDF 1.4, one vector page, standard Helvetica with WinAnsi encoding (not embedded); characters
  outside WinAnsi become `?` on the page. The document `/Title` is UTF-16BE hex with a byte order
  mark, so metadata keeps every character.

Text is measured with Helvetica AFM advances; characters outside WinAnsi count a full em, because
SVG draws their real glyphs, so truncation and clearance never under-measure them.

No dependency was added. All writers emit fixed decimals and fixed object order without dates, so
identical input yields identical bytes.

### Persistence

Drawings are derived output. A drawing document node would need a new authority schema version,
`.vshape` V8, migration, undo semantics and associative regeneration, which this slice does not
justify. The dialog therefore saves a versioned per-document preset (views, projection, sheet,
scale, units, toggles, title block) in browser local storage on the current device; it never
enters the document, its revisions or `.vshape`. Opening the dialog reprojects the current
committed revision, so drawings always reflect the model. Persisted, associative drawing sheets in
the document remain a follow-up decision.

## Consequences

Projection runs on the document worker; changing sheet, scale or title-block settings recomposes
locally without another projection. Manual dimensions, section and detail views, view
placement editing, GD&T, multi-sheet documents, embedded PDF fonts, DXF line weights and
persistent associative sheets are out of scope. Kernel tests use the real OCCT for hidden hole
edges, cylinder silhouettes, view extents, exact arcs, determinism and native disposal on success
and failure; format tests parse the SVG, read the DXF back per layer and check PDF structure. See
[drawings](../product/drawings.md) and the
[operator reference](../../.agents/skills/vibeshape-export/references/drawings.md).
