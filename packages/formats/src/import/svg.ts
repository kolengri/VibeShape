import { identityTransform, multiplyTransforms, scaledPoint2 } from "./affine"
import {
  type ImportedCurve,
  type ImportedCurvePath,
  type ImportLimits,
  type ImportSvgUnit,
  importLabel,
  LENGTH_UNIT_MM,
  type ParsedGeometryImport,
  requireImport,
} from "./contracts"
import { svgPathCurves } from "./svg-path"
import { svgLength, svgNumbers, svgTransform, svgViewport } from "./svg-transform"
import { type ImportXmlNode, parseImportXml } from "./xml"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
function requireSafeSvgAttributes(node: ImportXmlNode) {
  for (const [name, value] of Object.entries(node.attributes)) {
    requireImport(
      !name.toLowerCase().startsWith("on"),
      "unsafe-reference",
      "SVG event handlers are forbidden.",
      name,
    )
    requireImport(name !== "xml:base", "unsafe-reference", "SVG base URI overrides are forbidden.")
    if (name === "href" || name.endsWith(":href"))
      requireImport(
        value.startsWith("#"),
        "unsafe-reference",
        "External SVG references are forbidden.",
      )
    requireImport(
      !["clip-path", "mask", "filter"].includes(name),
      "unsupported-geometry",
      "SVG clipping, masks and filters require an explicit geometry policy.",
      name,
    )
    if (name === "style")
      requireImport(
        !/(?:transform|clip-path|mask|filter)\s*:|url\s*\(/i.test(value),
        "unsupported-geometry",
        "SVG CSS geometry effects are unsupported.",
      )
  }
}
function validateSvgTree(node: ImportXmlNode) {
  requireSafeSvgAttributes(node)
  requireImport(node.local !== "script", "unsafe-reference", "SVG scripts are forbidden.")
  requireImport(
    node.local !== "style",
    "unsupported-geometry",
    "SVG stylesheets require an explicit geometry policy.",
  )
  for (const child of node.children) validateSvgTree(child)
}
function ellipse(node: ImportXmlNode, scale: number): ImportedCurve[] {
  const center = scaledPoint2(
    svgLength(node.attributes.cx, scale, 0),
    svgLength(node.attributes.cy, scale, 0),
    scale,
  )
  if (node.local === "circle")
    return [{ type: "circle", center, radius: svgLength(node.attributes.r, scale, 0) * scale }]
  return [
    {
      type: "ellipse",
      center,
      xAxis: [svgLength(node.attributes.rx, scale, 0) * scale, 0],
      yAxis: [0, svgLength(node.attributes.ry, scale, 0) * scale],
    },
  ]
}
function rectangle(node: ImportXmlNode, scale: number) {
  const x = svgLength(node.attributes.x, scale, 0)
  const y = svgLength(node.attributes.y, scale, 0)
  const w = svgLength(node.attributes.width, scale, 0)
  const h = svgLength(node.attributes.height, scale, 0)
  requireImport(w > 0 && h > 0, "invalid-geometry", "SVG rectangles require positive dimensions.")
  const rx = Math.min(
    svgLength(node.attributes.rx, scale, svgLength(node.attributes.ry, scale, 0)),
    w / 2,
  )
  const ry = Math.min(
    svgLength(node.attributes.ry, scale, svgLength(node.attributes.rx, scale, 0)),
    h / 2,
  )
  requireImport(
    rx >= 0 && ry >= 0,
    "invalid-geometry",
    "SVG rectangle corner radii must be nonnegative.",
  )
  const d =
    rx === 0 || ry === 0
      ? `M${x} ${y}h${w}v${h}h${-w}Z`
      : `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  return d
}
function polygonPaths(node: ImportXmlNode, scale: number, limits: ImportLimits) {
  const coordinates = svgNumbers(node.attributes.points ?? "", limits.pathSegments * 2 + 2)
  requireImport(
    coordinates.length >= 4 && coordinates.length % 2 === 0,
    "invalid-format",
    "SVG polygons require XY point pairs.",
  )
  const points: string[] = []
  for (let index = 0; index < coordinates.length; index += 2)
    points.push(`${coordinates[index]} ${coordinates[index + 1]}`)
  return svgPathCurves(`M${points.join("L")}${node.local === "polygon" ? "Z" : ""}`, scale, limits)
}
function shapePaths(node: ImportXmlNode, scale: number, limits: ImportLimits) {
  if (node.local === "path") return svgPathCurves(node.attributes.d ?? "", scale, limits)
  if (node.local === "rect") return svgPathCurves(rectangle(node, scale), scale, limits)
  if (node.local === "circle" || node.local === "ellipse")
    return [{ closed: true, segments: ellipse(node, scale) }]
  if (node.local === "line")
    return [
      {
        closed: false,
        segments: [
          {
            type: "line" as const,
            start: scaledPoint2(
              svgLength(node.attributes.x1, scale, 0),
              svgLength(node.attributes.y1, scale, 0),
              scale,
            ),
            end: scaledPoint2(
              svgLength(node.attributes.x2, scale, 0),
              svgLength(node.attributes.y2, scale, 0),
              scale,
            ),
          },
        ],
      },
    ]
  if (node.local === "polyline" || node.local === "polygon")
    return polygonPaths(node, scale, limits)
  requireImport(false, "unsupported-geometry", "Unsupported SVG geometry element.", node.local)
}
export function parseSvgGeometry(
  bytes: Uint8Array,
  units: ImportSvgUnit,
  limits: ImportLimits,
): ParsedGeometryImport {
  const root = parseImportXml(bytes, limits)
  requireImport(
    root.local === "svg" && root.namespace === SVG_NAMESPACE,
    "invalid-format",
    "SVG requires its canonical root namespace.",
  )
  validateSvgTree(root)
  const scale = LENGTH_UNIT_MM[units]
  const paths: ImportedCurvePath[] = []
  let segments = 0
  const appendSourcePath = (
    node: ImportXmlNode,
    path: { closed: boolean; segments: ImportedCurve[] },
    transform: number[],
    layer: string | undefined,
  ) => {
    const label = importLabel(node.attributes.id)
    paths.push({
      id: `svg-path-${paths.length + 1}`,
      ...(label ? { label } : {}),
      ...(layer ? { layer } : {}),
      transform,
      ...path,
    })
  }
  const visit = (node: ImportXmlNode, parent: number[], layer?: string) => {
    requireSafeSvgAttributes(node)
    requireImport(
      node.namespace === SVG_NAMESPACE,
      "unsupported-geometry",
      "Unsupported SVG extension geometry.",
      node.local,
    )
    if (["title", "desc", "metadata", "defs"].includes(node.local)) return
    let transform = multiplyTransforms(parent, svgTransform(node.attributes.transform, scale))
    if (node.local === "svg") transform = multiplyTransforms(transform, svgViewport(node, scale))
    if (node.local === "svg" || node.local === "g") {
      const childLayer =
        importLabel(node.attributes["inkscape:label"] ?? node.attributes.id) ?? layer
      for (const child of node.children) visit(child, transform, childLayer)
      return
    }
    requireImport(
      node.children.length === 0,
      "unsupported-geometry",
      "SVG shapes with nested content are unsupported.",
      node.local,
    )
    for (const path of shapePaths(node, scale, limits)) {
      segments += path.segments.length
      requireImport(
        segments <= limits.pathSegments,
        "resource-limit",
        "SVG exceeds its aggregate analytical segment budget.",
      )
      appendSourcePath(node, path, transform, layer)
    }
  }
  visit(root, identityTransform())
  return {
    kind: "sketch-curves",
    format: "svg",
    units: {
      coordinateUnit: "mm",
      sourceUnit: units,
      millimetersPerUnit: scale,
      policy: "selected",
    },
    paths,
    warnings: [],
  }
}
