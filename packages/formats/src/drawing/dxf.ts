import { type DrawingSheet, type SheetLayer, type SheetPrimitive, sheetNumber } from "./sheet"

/** Sheet layers as DXF layers with ACI colours and R12 line types. */
export const DXF_LAYERS: Readonly<
  Record<SheetLayer, Readonly<{ name: string; color: number; lineType: string }>>
> = {
  visible: { name: "VISIBLE", color: 7, lineType: "CONTINUOUS" },
  hidden: { name: "HIDDEN", color: 8, lineType: "HIDDEN" },
  dimension: { name: "DIMENSIONS", color: 3, lineType: "CONTINUOUS" },
  title: { name: "TITLE", color: 5, lineType: "CONTINUOUS" },
  frame: { name: "FRAME", color: 7, lineType: "CONTINUOUS" },
}
const DEGREES = 180 / Math.PI

/** R12 text is single-byte; characters outside printable ASCII use the `\U+XXXX` escape. */
function dxfText(value: string) {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 63
      if (code >= 32 && code < 127) return character
      return `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`
    })
    .join("")
}

function pairs(...entries: (readonly [number, string | number])[]) {
  return entries.flatMap(([code, value]) => [
    String(code),
    typeof value === "number" ? sheetNumber(value, 6) : value,
  ])
}

function entity(primitive: SheetPrimitive): string[] {
  const layer = DXF_LAYERS[primitive.layer].name
  switch (primitive.kind) {
    case "line":
      return pairs(
        [0, "LINE"],
        [8, layer],
        [10, primitive.start[0]],
        [20, primitive.start[1]],
        [30, 0],
        [11, primitive.end[0]],
        [21, primitive.end[1]],
        [31, 0],
      )
    case "circle":
      return pairs(
        [0, "CIRCLE"],
        [8, layer],
        [10, primitive.center[0]],
        [20, primitive.center[1]],
        [30, 0],
        [40, primitive.radius],
      )
    case "arc":
      return pairs(
        [0, "ARC"],
        [8, layer],
        [10, primitive.center[0]],
        [20, primitive.center[1]],
        [30, 0],
        [40, primitive.radius],
        [50, normalizedDegrees(primitive.startAngle)],
        [51, normalizedDegrees(primitive.endAngle)],
      )
    case "polyline":
      return [
        ...pairs([0, "POLYLINE"], [8, layer], [66, "1"], [10, 0], [20, 0], [30, 0], [70, "0"]),
        ...primitive.points.flatMap((point) =>
          pairs([0, "VERTEX"], [8, layer], [10, point[0]], [20, point[1]], [30, 0]),
        ),
        ...pairs([0, "SEQEND"], [8, layer]),
      ]
    case "arrow": {
      const [a, b, c] = primitive.points
      return pairs(
        [0, "SOLID"],
        [8, layer],
        [10, a[0]],
        [20, a[1]],
        [30, 0],
        [11, b[0]],
        [21, b[1]],
        [31, 0],
        [12, c[0]],
        [22, c[1]],
        [32, 0],
        [13, c[0]],
        [23, c[1]],
        [33, 0],
      )
    }
    case "text": {
      const alignment = primitive.align === "start" ? 0 : primitive.align === "middle" ? 1 : 2
      return pairs(
        [0, "TEXT"],
        [8, layer],
        [10, primitive.position[0]],
        [20, primitive.position[1]],
        [30, 0],
        [40, primitive.height],
        [1, dxfText(primitive.text)],
        [50, primitive.rotation],
        [72, String(alignment)],
        ...(alignment === 0
          ? []
          : ([
              [11, primitive.position[0]],
              [21, primitive.position[1]],
              [31, 0],
            ] as const)),
      )
    }
  }
}

function normalizedDegrees(radians: number) {
  const degrees = (radians * DEGREES) % 360
  return degrees < 0 ? degrees + 360 : degrees
}

function tables() {
  const layers = Object.values(DXF_LAYERS)
  return [
    ...pairs([0, "SECTION"], [2, "TABLES"]),
    ...pairs([0, "TABLE"], [2, "LTYPE"], [70, "2"]),
    ...pairs(
      [0, "LTYPE"],
      [2, "CONTINUOUS"],
      [70, "0"],
      [3, "Solid line"],
      [72, "65"],
      [73, "0"],
      [40, 0],
    ),
    ...pairs(
      [0, "LTYPE"],
      [2, "HIDDEN"],
      [70, "0"],
      [3, "Hidden __ __ __"],
      [72, "65"],
      [73, "2"],
      [40, 4.5],
      [49, 3],
      [49, -1.5],
    ),
    ...pairs([0, "ENDTAB"]),
    ...pairs([0, "TABLE"], [2, "LAYER"], [70, String(layers.length)]),
    ...layers.flatMap((layer) =>
      pairs(
        [0, "LAYER"],
        [2, layer.name],
        [70, "0"],
        [62, String(layer.color)],
        [6, layer.lineType],
      ),
    ),
    ...pairs([0, "ENDTAB"]),
    ...pairs([0, "TABLE"], [2, "STYLE"], [70, "1"]),
    ...pairs(
      [0, "STYLE"],
      [2, "STANDARD"],
      [70, "0"],
      [40, 0],
      [41, 1],
      [50, 0],
      [71, "0"],
      [42, 3.5],
      [3, "txt"],
      [4, ""],
    ),
    ...pairs([0, "ENDTAB"]),
    ...pairs([0, "ENDSEC"]),
  ]
}

/**
 * AutoCAD R12 (AC1009) ASCII DXF of the composed sheet in millimetres at sheet scale. Line weights
 * are not representable in R12; layers carry the line type and colour instead.
 */
export function writeDrawingDxf(sheet: DrawingSheet): string {
  const header = pairs(
    [0, "SECTION"],
    [2, "HEADER"],
    [9, "$ACADVER"],
    [1, "AC1009"],
    [9, "$DWGCODEPAGE"],
    [3, "ANSI_1252"],
    [9, "$INSBASE"],
    [10, 0],
    [20, 0],
    [30, 0],
    [9, "$EXTMIN"],
    [10, 0],
    [20, 0],
    [30, 0],
    [9, "$EXTMAX"],
    [10, sheet.width],
    [20, sheet.height],
    [30, 0],
    [9, "$LIMMIN"],
    [10, 0],
    [20, 0],
    [9, "$LIMMAX"],
    [10, sheet.width],
    [20, sheet.height],
    [9, "$LTSCALE"],
    [40, 1],
    [0, "ENDSEC"],
  )
  const entities = [
    ...pairs([0, "SECTION"], [2, "ENTITIES"]),
    ...sheet.groups.flatMap((group) => group.primitives.flatMap(entity)),
    ...pairs([0, "ENDSEC"]),
  ]
  return [...header, ...tables(), ...entities, "0", "EOF", ""].join("\r\n")
}
