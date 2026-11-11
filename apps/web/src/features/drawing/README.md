# Drawings

Derived engineering drawings; see [ADR-0160](../../../../../docs/adr/0160-derived-engineering-drawings.md)
and the [product description](../../../../../docs/product/drawings.md).

- `use-drawing.ts` asks the active document session for an exact projection
  (`projectActiveDocumentDrawing`) once per document, revision, Part and canonical view set, ignores
  stale results and recomposes the sheet locally for every other setting. The preview is the SVG
  writer's output as a `data:` image, so it is byte-identical to **Download SVG**.
- `drawing-file.ts` composes sheets and downloads files. `drawingSheetCopy()` uses the English
  source catalog for automation; the dialog builds the same shape from the active locale.
- `drawing-preset.ts` keeps a versioned per-document preset in local storage. It is a device
  convenience, never document state; unreadable storage falls back to defaults.
- `../../automation/drawing-export-source.ts` serves `prepare_drawing_export` with the same
  projection, composition and writers, bound to the paired document and exact revision.

The dialog holds settings in React state so title-block text is not trimmed while typing; the
schema trims when composing and saving. Download buttons stay disabled until the current
projection is ready.
