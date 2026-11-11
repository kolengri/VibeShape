import { describe, expect, it } from "bun:test"
import {
  DRAWING_VIEWS,
  type DrawingSettings,
  drawingSettingsSchema,
} from "@vibeshape/domain/drawing"
import {
  DRAWING_CHORD_TOLERANCE_MM,
  DRAWING_VIEW_IDS,
  type DrawingProjection,
  type DrawingViewProjection,
} from "@vibeshape/protocol"
import DxfParser from "dxf-parser/dist/dxf-parser.js"
import { SaxesParser } from "saxes"
import {
  composeDrawingSheet,
  type DrawingSheet,
  type DrawingSheetCopy,
  writeDrawingDxf,
  writeDrawingFile,
  writeDrawingPdf,
  writeDrawingSvg,
} from "./index"
import { primitiveBox } from "./text-metrics"

const copy: DrawingSheetCopy = {
  viewLabels: {
    front: "Front",
    back: "Back",
    top: "Top",
    bottom: "Bottom",
    right: "Right",
    left: "Left",
    isometric: "Isometric",
  },
  captions: {
    title: "Title",
    drawingNumber: "Drawing number",
    author: "Author",
    date: "Date",
    material: "Material",
    scale: "Scale",
    units: "Units",
    projection: "Projection",
    sheet: "Sheet",
  },
  projections: { "first-angle": "First angle", "third-angle": "Third angle" },
  units: { mm: "mm", in: "in" },
}

function rectangle(view: DrawingViewProjection["view"], width: number, height: number) {
  const edges: DrawingViewProjection["edges"] = [
    [0, 0, width, 0],
    [width, 0, width, height],
    [width, height, 0, height],
    [0, height, 0, 0],
  ].map(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => ({
    visibility: "visible",
    edgeClass: "sharp",
    curve: { kind: "line", start: [x1, y1], end: [x2, y2] },
  }))
  return { view, bounds: { min: [0, 0], max: [width, height] }, edges } as DrawingViewProjection
}

/** A 40 × 30 × 10 mm box with a vertical Ø10 mm through-hole, as the kernel projects it. */
function boxProjection(): DrawingProjection {
  const front = rectangle("front", 40, 10)
  const top = rectangle("top", 40, 30)
  const right = rectangle("right", 30, 10)
  const isometric = rectangle("isometric", 50, 36)
  return {
    chordTolerance: DRAWING_CHORD_TOLERANCE_MM,
    bodyCount: 1,
    views: [
      {
        ...front,
        edges: [
          ...front.edges,
          ...[15, 25].map((x) => ({
            visibility: "hidden" as const,
            edgeClass: "outline" as const,
            curve: {
              kind: "line" as const,
              start: [x, 0] as [number, number],
              end: [x, 10] as [number, number],
            },
          })),
        ],
      },
      {
        ...top,
        edges: [
          ...top.edges,
          {
            visibility: "visible",
            edgeClass: "sharp",
            curve: { kind: "circle", center: [20, 15], radius: 5 },
          },
          {
            visibility: "visible",
            edgeClass: "sharp",
            curve: {
              kind: "arc",
              center: [5, 5],
              radius: 2,
              startAngle: Math.PI,
              endAngle: 1.5 * Math.PI,
            },
          },
        ],
      },
      right,
      isometric,
    ],
  }
}

function sheetFor(overrides: Partial<DrawingSettings> = {}): DrawingSheet {
  return composeDrawingSheet({
    projection: boxProjection(),
    settings: { ...drawingSettingsSchema.parse({}), ...overrides },
    copy,
    documentTitle: "Bracket",
  })
}

function placed(sheet: DrawingSheet, view: string) {
  const rect = sheet.views.find((item) => item.view === view)
  if (!rect) throw new Error(`Missing ${view}`)
  return rect
}

describe("drawing sheet composition", () => {
  it("keeps the domain view list equal to the projection contract", () => {
    expect([...DRAWING_VIEWS]).toEqual([...DRAWING_VIEW_IDS])
  })

  it("auto-scales to the largest standard scale and places views without overlap", () => {
    const sheet = sheetFor()
    expect(sheet.fits).toBe(true)
    expect(sheet.scale).toEqual({ numerator: 2, denominator: 1 })
    const front = placed(sheet, "front")
    expect(front.width).toBeCloseTo(80)
    expect(front.height).toBeCloseTo(20)
    const rects = sheet.views
    for (const [index, left] of rects.entries())
      for (const right of rects.slice(index + 1))
        expect(
          left.x + left.width <= right.x ||
            right.x + right.width <= left.x ||
            left.y + left.height <= right.y ||
            right.y + right.height <= left.y,
        ).toBe(true)
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThan(10)
      expect(rect.x + rect.width).toBeLessThan(sheet.width - 10)
      expect(rect.y).toBeGreaterThan(10 + 32)
      expect(rect.y + rect.height).toBeLessThan(sheet.height - 10)
    }
  })

  it("aligns projected views and swaps their sides between first and third angle", () => {
    const first = sheetFor({ projection: "first-angle" })
    const third = sheetFor({ projection: "third-angle" })
    for (const sheet of [first, third]) {
      expect(placed(sheet, "top").x).toBeCloseTo(placed(sheet, "front").x)
      expect(placed(sheet, "right").y).toBeCloseTo(placed(sheet, "front").y)
    }
    expect(placed(first, "top").y).toBeLessThan(placed(first, "front").y)
    expect(placed(first, "right").x).toBeLessThan(placed(first, "front").x)
    expect(placed(third, "top").y).toBeGreaterThan(placed(third, "front").y)
    expect(placed(third, "right").x).toBeGreaterThan(placed(third, "front").x)
  })

  it("honours an explicit scale and reports when it does not fit", () => {
    const half = sheetFor({ scale: { mode: "explicit", numerator: 1, denominator: 2 } })
    expect(half.fits).toBe(true)
    expect(placed(half, "front").width).toBeCloseTo(20)
    const huge = sheetFor({ scale: { mode: "explicit", numerator: 100, denominator: 1 } })
    expect(huge.fits).toBe(false)
  })

  it("adds overall dimensions, diameter callouts and omits hidden lines when requested", () => {
    const texts = (sheet: DrawingSheet, group: string) =>
      sheet.groups
        .find(({ id }) => id === group)
        ?.primitives.flatMap((item) => (item.kind === "text" ? [item.text] : [])) ?? []
    const sheet = sheetFor()
    expect(texts(sheet, "dimensions")).toEqual(expect.arrayContaining(["40", "10", "30", "Ø10"]))
    expect(texts(sheet, "labels")).toEqual(["Front", "Top", "Right", "Isometric"])
    expect(texts(sheet, "title-block")).toEqual(
      expect.arrayContaining(["Bracket", "2:1", "First angle", "ISO A3"]),
    )
    const inches = sheetFor({ units: "in" })
    expect(texts(inches, "dimensions")).toEqual(expect.arrayContaining(["1.575", "Ø0.394"]))
    const hidden = (value: DrawingSheet) =>
      value.groups.flatMap(({ primitives }) => primitives).filter(({ layer }) => layer === "hidden")
    expect(hidden(sheet)).toHaveLength(2)
    expect(hidden(sheetFor({ hiddenLines: false }))).toHaveLength(0)
    expect(texts(sheetFor({ dimensions: false }), "dimensions")).toEqual([])
  })

  it("truncates long title block values", () => {
    const sheet = sheetFor({
      titleBlock: { title: "x".repeat(80), drawingNumber: "", author: "", date: "", material: "" },
    })
    const title = sheet.groups
      .find(({ id }) => id === "title-block")
      ?.primitives.find((item) => item.kind === "text" && item.text.startsWith("xxx"))
    expect(title?.kind === "text" && title.text.endsWith("…")).toBe(true)
  })

  it("fits wide title block values to their cells by measured glyph advances", () => {
    const sheet = sheetFor({
      titleBlock: {
        title: "W".repeat(30),
        drawingNumber: "WWWWWWWWWWWWWWWWWWWW",
        author: "MMMMMMMMMMMMMMMMMMMM",
        date: "2026-11-11",
        material: "PLA 20% WWWWWWWWWWWWWWWWWW",
      },
    })
    const texts = sheet.groups
      .find(({ id }) => id === "title-block")
      ?.primitives.flatMap((item) => (item.kind === "text" ? [item] : []))
    if (!texts) throw new Error("Missing title block texts.")
    const titleText = texts.find((item) => item.text.startsWith("WWW") && item.height === 5)
    expect(titleText?.text.endsWith("…")).toBe(true)
    // Row edges from the block origin: identification row, material/author/date, scale/units/projection/sheet.
    const origin: [number, number] = [sheet.width - 10 - 180, 10]
    const rows: [number, number[]][] = [
      [20, [120, 180]],
      [10, [70, 120, 180]],
      [0, [40, 70, 97, 180]],
    ]
    for (const text of texts) {
      const box = primitiveBox(text)
      const [, edges = []] = rows.find(([bottom]) => text.position[1] - origin[1] >= bottom) ?? []
      const right = edges.map((edge) => origin[0] + edge).find((edge) => edge > text.position[0])
      if (right === undefined) throw new Error(`No cell to the right of ${text.text}.`)
      expect({ text: text.text, overflow: box[2] > right - 1 }).toEqual({
        text: text.text,
        overflow: false,
      })
    }
  })
})

describe("drawing writers", () => {
  it("writes a well-formed SVG with view groups and line-type styles", () => {
    const svg = writeDrawingSvg(sheetFor())
    const parser = new SaxesParser({ xmlns: true })
    const ids: string[] = []
    const classes = new Set<string>()
    parser.on("opentag", (tag) => {
      const id = tag.attributes.id
      if (id && typeof id !== "string") ids.push(id.value)
      const value = tag.attributes.class
      if (value && typeof value !== "string") classes.add(value.value)
    })
    parser.write(svg).close()
    expect(ids).toEqual([
      "frame",
      "view-front",
      "view-top",
      "view-right",
      "view-isometric",
      "dimensions",
      "labels",
      "title-block",
    ])
    expect([...classes].sort()).toEqual(["dimension", "frame", "hidden", "title", "visible"])
    expect(svg).toContain(".hidden{stroke:#000;stroke-width:0.25;fill:none;stroke-dasharray:3 1.5}")
    expect(svg).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"')
  })

  it("writes an R12 DXF whose entities parse back per layer", () => {
    const dxf = writeDrawingDxf(sheetFor())
    expect(dxf).toContain("AC1009")
    const parsed = new DxfParser().parseSync(dxf) as {
      entities: { type: string; layer: string }[]
      tables: { layer: { layers: Record<string, { name: string }> } }
    }
    const counts = new Map<string, number>()
    for (const entity of parsed.entities)
      counts.set(
        `${entity.layer}:${entity.type}`,
        (counts.get(`${entity.layer}:${entity.type}`) ?? 0) + 1,
      )
    expect(Object.keys(parsed.tables.layer.layers).sort()).toEqual([
      "DIMENSIONS",
      "FRAME",
      "HIDDEN",
      "TITLE",
      "VISIBLE",
    ])
    expect(counts.get("VISIBLE:LINE")).toBe(16)
    expect(counts.get("VISIBLE:CIRCLE")).toBe(1)
    expect(counts.get("VISIBLE:ARC")).toBe(1)
    expect(counts.get("HIDDEN:LINE")).toBe(2)
    expect(counts.get("FRAME:POLYLINE")).toBe(1)
    expect(counts.get("DIMENSIONS:SOLID")).toBe(2 * 2 * 3 + 1)
    expect(counts.get("TITLE:TEXT")).toBe(14)
    expect(counts.get("TITLE:CIRCLE")).toBe(2)
  })

  it("escapes non-ASCII DXF text", () => {
    const dxf = writeDrawingDxf(
      sheetFor({
        titleBlock: { title: "Кронштейн", drawingNumber: "", author: "", date: "", material: "" },
      }),
    )
    expect(dxf).toContain("\\U+041A\\U+0440")
    expect([...dxf].every((character) => character.charCodeAt(0) < 128)).toBe(true)
  })

  it("keeps typed DXF control codes literal and uses the R12 diameter code", () => {
    const title = "50% %%c \\U+0041 \\M+1 %Ø a\\b \u{1D538}"
    const dxf = writeDrawingDxf(
      sheetFor({ titleBlock: { title, drawingNumber: "", author: "", date: "", material: "" } }),
    )
    expect(dxf).toContain("\r\n1\r\n50% %%%%%%c \\U+005CU+0041 \\U+005CM+1 %%%%%c a\\b ?\r\n")
    expect(dxf).toContain("\r\n1\r\n%%c10\r\n")
    expect([...dxf].every((character) => character.charCodeAt(0) < 128)).toBe(true)
  })

  it("leaves a lone percent sign literal for readers that ignore control codes", () => {
    const dxf = writeDrawingDxf(
      sheetFor({
        titleBlock: { title: "Box", drawingNumber: "", author: "", date: "", material: "PLA 20%" },
      }),
    )
    expect(dxf).toContain("\r\n1\r\nPLA 20%\r\n")
    expect(dxf).not.toContain("%%%")
  })

  it("writes a structurally valid single-page vector PDF", () => {
    const bytes = writeDrawingPdf(sheetFor())
    const text = new TextDecoder("latin1").decode(bytes)
    expect(text.startsWith("%PDF-1.4\n")).toBe(true)
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1)
    expect(text).toContain("/Count 1")
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1])
    expect(text.slice(startxref, startxref + 4)).toBe("xref")
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((match) =>
      Number(match[1]),
    )
    expect(entries).toHaveLength(6)
    for (const [index, offset] of entries.entries())
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`)
    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(text)?.[1])
    const streamStart = text.indexOf("stream\n") + "stream\n".length
    expect(text.slice(streamStart + length, streamStart + length + "\nendstream".length)).toBe(
      "\nendstream",
    )
    expect(text).toContain("[3 1.5] 0 d")
    expect(text).toContain("/BaseFont /Helvetica")
    expect(text).toContain("(\\330") // Ø as a WinAnsi octal escape
  })

  it("writes the PDF title as UTF-16BE text with a byte order mark", () => {
    const pdf = new TextDecoder("latin1").decode(
      writeDrawingPdf(
        sheetFor({
          titleBlock: { title: "€…–—", drawingNumber: "", author: "", date: "", material: "" },
        }),
      ),
    )
    expect(pdf).toContain("/Title <FEFF20AC202620132014>")
    const astral = new TextDecoder("latin1").decode(
      writeDrawingPdf(
        sheetFor({
          titleBlock: { title: "\u{1D538}", drawingNumber: "", author: "", date: "", material: "" },
        }),
      ),
    )
    expect(astral).toContain("/Title <FEFFD835DD38>")
  })

  it("produces identical bytes for identical input", () => {
    for (const format of ["svg", "dxf", "pdf"] as const)
      expect(writeDrawingFile(sheetFor(), format)).toEqual(writeDrawingFile(sheetFor(), format))
  })
})
