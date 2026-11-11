import {
  type DrawingSheet,
  type PrimitiveWriters,
  type SheetLayer,
  type SheetPrimitive,
  sheetNumber,
  writePrimitive,
} from "./sheet"

/** Sheet layers as DXF layers with ACI colours and R12 line types. */
const DXF_LAYERS: Readonly<
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

const point3 = (code: number, point: readonly [number, number]) =>
  [
    [code, point[0]],
    [code + 10, point[1]],
    [code + 20, 0],
  ] as const

const ENTITY_WRITERS: PrimitiveWriters<(layer: string) => string[]> = {
  line: (item) => (layer) =>
    pairs([0, "LINE"], [8, layer], ...point3(10, item.start), ...point3(11, item.end)),
  circle: (item) => (layer) =>
    pairs([0, "CIRCLE"], [8, layer], ...point3(10, item.center), [40, item.radius]),
  arc: (item) => (layer) =>
    pairs(
      [0, "ARC"],
      [8, layer],
      ...point3(10, item.center),
      [40, item.radius],
      [50, normalizedDegrees(item.startAngle)],
      [51, normalizedDegrees(item.endAngle)],
    ),
  polyline: (item) => (layer) => [
    ...pairs([0, "POLYLINE"], [8, layer], [66, "1"], ...point3(10, [0, 0]), [70, "0"]),
    ...item.points.flatMap((point) => pairs([0, "VERTEX"], [8, layer], ...point3(10, point))),
    ...pairs([0, "SEQEND"], [8, layer]),
  ],
  arrow: (item) => (layer) => {
    const [a, b, c] = item.points
    return pairs(
      [0, "SOLID"],
      [8, layer],
      ...point3(10, a),
      ...point3(11, b),
      ...point3(12, c),
      ...point3(13, c),
    )
  },
  text: (item) => (layer) => {
    const alignment = { start: 0, middle: 1, end: 2 }[item.align]
    return pairs(
      [0, "TEXT"],
      [8, layer],
      ...point3(10, item.position),
      [40, item.height],
      [1, dxfText(item.text)],
      [50, item.rotation],
      [72, String(alignment)],
      ...(alignment === 0 ? [] : point3(11, item.position)),
    )
  },
}

function entity(primitive: SheetPrimitive): string[] {
  return writePrimitive(ENTITY_WRITERS, primitive)(DXF_LAYERS[primitive.layer].name)
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
