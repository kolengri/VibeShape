import { strFromU8, strToU8 } from "fflate"
import { SaxesParser } from "saxes"
import { type ImportLimits, requireImport } from "./contracts"

export type ImportXmlNode = Readonly<{
  local: string
  namespace: string
  attributes: Readonly<Record<string, string>>
  children: ImportXmlNode[]
  text: string
}>
type ImportXmlElement = Pick<ImportXmlNode, "local" | "namespace">
export type ImportXmlGeometryBudget = (
  element: ImportXmlElement,
  ancestors: readonly ImportXmlElement[],
) => boolean
export function decodeImportText(bytes: Uint8Array) {
  const text = strFromU8(bytes)
  const encoded = strToU8(text)
  requireImport(
    encoded.length === bytes.length && encoded.every((value, index) => value === bytes[index]),
    "invalid-format",
    "Import text is not valid UTF-8.",
  )
  return text
}
export function parseImportXml(
  bytes: Uint8Array,
  limits: ImportLimits,
  budget = { nodes: 0 },
  consumeGeometryElement?: ImportXmlGeometryBudget,
): ImportXmlNode {
  const text = decodeImportText(bytes)
  requireImport(
    !/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text),
    "unsafe-reference",
    "DTD and entity declarations are forbidden.",
  )
  const parser = new SaxesParser({ xmlns: true })
  const stack: Array<{
    local: string
    namespace: string
    attributes: Record<string, string>
    children: ImportXmlNode[]
    text: string
  }> = []
  let root: ImportXmlNode | undefined
  parser.on("doctype", () =>
    requireImport(false, "unsafe-reference", "DTD declarations are forbidden."),
  )
  parser.on("processinginstruction", () =>
    requireImport(false, "unsafe-reference", "XML processing instructions are unsupported."),
  )
  parser.on("opentag", (tag) => {
    const geometryElement = consumeGeometryElement?.(
      { local: tag.local, namespace: tag.uri },
      stack,
    )
    if (!geometryElement) budget.nodes++
    requireImport(
      budget.nodes <= limits.xmlNodes && stack.length < limits.xmlDepth,
      "resource-limit",
      "XML exceeds its node or depth budget.",
    )
    const attributes: Record<string, string> = Object.create(null)
    for (const attribute of Object.values(tag.attributes))
      attributes[attribute.name] = attribute.value
    const node = { local: tag.local, namespace: tag.uri, attributes, children: [], text: "" }
    if (stack.length === 0) {
      requireImport(!root, "invalid-format", "XML has multiple document roots.")
      root = node
    } else stack[stack.length - 1]?.children.push(node)
    stack.push(node)
  })
  const addText = (value: string) => {
    const node = stack[stack.length - 1]
    if (node) node.text += value
  }
  parser.on("text", addText)
  parser.on("cdata", addText)
  parser.on("closetag", () => {
    stack.pop()
  })
  parser.write(text).close()
  requireImport(Boolean(root), "invalid-format", "XML has no document root.")
  return root as ImportXmlNode
}
export function xmlChildren(node: ImportXmlNode, local: string) {
  return node.children.filter((child) => child.local === local)
}
export function xmlChild(node: ImportXmlNode, local: string) {
  const children = xmlChildren(node, local)
  requireImport(
    children.length === 1,
    "invalid-format",
    `Expected exactly one ${local} element.`,
    node.local,
  )
  return children[0] as ImportXmlNode
}
export function xmlNumber(value: string | undefined, fallback?: number) {
  if (value === undefined && fallback !== undefined) return fallback
  requireImport(
    value !== undefined &&
      value.length <= 64 &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value),
    "invalid-format",
    "Expected a finite numeric XML attribute.",
  )
  const number = Number(value)
  requireImport(
    Number.isFinite(number),
    "invalid-geometry",
    "XML numeric attributes must be finite.",
  )
  return number
}
