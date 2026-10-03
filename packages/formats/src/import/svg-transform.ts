import { z } from "zod"
import { identityTransform, multiplyTransforms, validateTransform } from "./affine"
import { LENGTH_UNIT_MM, requireImport } from "./contracts"
import { type ImportXmlNode, xmlNumber } from "./xml"

export function svgNumbers(value: string, maximum: number) {
  requireImport(
    !/^\s*,|,\s*,/.test(value),
    "invalid-format",
    "SVG number lists have an invalid comma separator.",
  )
  const pattern = /[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/gy
  const numbers: number[] = []
  let offset = 0
  while (offset < value.trimEnd().length) {
    pattern.lastIndex = offset
    const match = pattern.exec(value)
    requireImport(Boolean(match), "invalid-format", "Invalid SVG number list.")
    if (!match) break
    requireImport(
      numbers.length < maximum,
      "resource-limit",
      "SVG exceeds its numeric-token budget.",
    )
    numbers.push(xmlNumber(match[1]))
    offset = pattern.lastIndex
  }
  requireImport(
    !value.trimEnd().endsWith(","),
    "invalid-format",
    "SVG number lists must not end with a comma.",
  )
  return numbers
}
function svgMatrix(values: readonly number[], scale: number) {
  const [a, b, c, d, e, f] = z
    .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
    .parse(values)
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e * scale, f * scale, 0, 1]
}
function svgRotation(values: readonly number[], radians: number, scale: number) {
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const x = (values[1] ?? 0) * scale
  const y = (values[2] ?? 0) * scale
  return [
    cosine,
    sine,
    0,
    0,
    -sine,
    cosine,
    0,
    0,
    0,
    0,
    1,
    0,
    x - cosine * x + sine * y,
    y - sine * x - cosine * y,
    0,
    1,
  ]
}
function transformOperation(name: string, values: readonly number[], scale: number) {
  const sizes: Readonly<Record<string, readonly number[]>> = {
    matrix: [6],
    translate: [1, 2],
    scale: [1, 2],
    rotate: [1, 3],
    skewX: [1],
    skewY: [1],
  }
  requireImport(
    Boolean(sizes[name]?.includes(values.length)),
    "invalid-format",
    "Invalid SVG transform name or argument count.",
    name,
  )
  const first = values[0] ?? 0
  const matrix = identityTransform()
  if (name === "matrix") return svgMatrix(values, scale)
  if (name === "translate") {
    matrix[12] = first * scale
    matrix[13] = (values[1] ?? 0) * scale
    return matrix
  }
  if (name === "scale") {
    matrix[0] = first
    matrix[5] = values[1] ?? first
    return matrix
  }
  const radians = (first * Math.PI) / 180
  if (name === "skewX") {
    matrix[4] = Math.tan(radians)
    return matrix
  }
  if (name === "skewY") {
    matrix[1] = Math.tan(radians)
    return matrix
  }
  return svgRotation(values, radians, scale)
}
export function svgTransform(value: string | undefined, scale: number) {
  if (!value?.trim()) return identityTransform()
  const operation = /[\s,]*([A-Za-z]+)\s*\(([^()]*)\)/gy
  let offset = 0
  let matrix = identityTransform()
  let count = 0
  while (offset < value.trimEnd().length) {
    operation.lastIndex = offset
    const match = operation.exec(value)
    requireImport(Boolean(match), "invalid-format", "Malformed SVG transform list.")
    if (!match) break
    requireImport(++count <= 64, "resource-limit", "SVG has too many transform operations.")
    matrix = multiplyTransforms(
      matrix,
      transformOperation(match[1] ?? "", svgNumbers(match[2] ?? "", 6), scale),
    )
    offset = operation.lastIndex
  }
  validateTransform(matrix)
  return matrix
}
export function svgLength(value: string | undefined, baseScale: number, fallback: number) {
  if (value === undefined) return fallback
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(mm|cm|m|in|ft|um|px|pt|pc)?$/.exec(
    value.trim(),
  )
  requireImport(
    Boolean(match),
    "unsupported-geometry",
    "SVG percentage or unresolved viewport lengths require an explicit policy.",
  )
  const number = xmlNumber(match?.[1])
  const unit = match?.[2]
  const unitScale =
    unit === "pt"
      ? 25.4 / 72
      : unit === "pc"
        ? 25.4 / 6
        : unit
          ? LENGTH_UNIT_MM[unit as keyof typeof LENGTH_UNIT_MM]
          : baseScale
  return (number * (unitScale ?? baseScale)) / baseScale
}
function alignmentOffset(name: string | undefined, extra: number) {
  return name === "Max" ? extra : name === "Mid" ? extra / 2 : 0
}
function aspectPlacement(
  aspect: string,
  boxWidth: number,
  boxHeight: number,
  width: number,
  height: number,
) {
  const parts = aspect.trim().split(/\s+/)
  const sx = width / boxWidth
  const sy = height / boxHeight
  if (parts[0] === "none") {
    requireImport(parts.length === 1, "invalid-format", "Invalid SVG aspect-ratio policy.")
    return { ax: sx, ay: sy, dx: 0, dy: 0 }
  }
  const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(parts[0] ?? "")
  requireImport(
    match !== null && parts.length <= 2 && [undefined, "meet", "slice"].includes(parts[1]),
    "unsupported-geometry",
    "Unsupported SVG aspect-ratio policy.",
  )
  const ax = parts[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy)
  return {
    ax,
    ay: ax,
    dx: alignmentOffset(match[1], width - boxWidth * ax),
    dy: alignmentOffset(match[2], height - boxHeight * ax),
  }
}
function validateViewportDimensions(node: ImportXmlNode, scale: number) {
  for (const attribute of ["width", "height"])
    if (node.attributes[attribute] !== undefined)
      requireImport(
        svgLength(node.attributes[attribute], scale, 0) > 0,
        "invalid-geometry",
        "SVG viewport dimensions must be positive.",
      )
}
const viewBoxSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite().positive(),
  z.number().finite().positive(),
])
export function svgViewport(node: ImportXmlNode, scale: number) {
  const matrix = identityTransform()
  const x = svgLength(node.attributes.x, scale, 0)
  const y = svgLength(node.attributes.y, scale, 0)
  matrix[12] = x * scale
  matrix[13] = y * scale
  if (!node.attributes.viewBox) {
    validateViewportDimensions(node, scale)
    return matrix
  }
  const parsedBox = viewBoxSchema.safeParse(svgNumbers(node.attributes.viewBox, 4))
  requireImport(
    parsedBox.success,
    "invalid-geometry",
    "SVG viewBox requires positive width and height.",
  )
  const box = parsedBox.data
  const width = svgLength(node.attributes.width, scale, box[2])
  const height = svgLength(node.attributes.height, scale, box[3])
  requireImport(
    width > 0 && height > 0,
    "invalid-geometry",
    "SVG viewport dimensions must be positive.",
  )
  const { ax, ay, dx, dy } = aspectPlacement(
    node.attributes.preserveAspectRatio ?? "xMidYMid meet",
    box[2],
    box[3],
    width,
    height,
  )
  matrix[0] = ax
  matrix[5] = ay
  matrix[12] = (x + dx - box[0] * ax) * scale
  matrix[13] = (y + dy - box[1] * ay) * scale
  validateTransform(matrix)
  return matrix
}
