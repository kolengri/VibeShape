import { type ImportLimits, requireImport } from "./contracts"
import { DxfInventory } from "./dxf-inventory"
import { decodeImportText } from "./xml"

const FLOAT_RANGES = [
  [10, 59],
  [110, 149],
  [210, 239],
  [460, 469],
  [1010, 1059],
] as const
const INTEGER_RANGES = [
  [60, 99],
  [160, 179],
  [270, 299],
  [370, 389],
  [400, 409],
  [420, 429],
  [440, 459],
  [1060, 1071],
] as const
function inRanges(code: number, ranges: readonly (readonly [number, number])[]) {
  return ranges.some(([minimum, maximum]) => code >= minimum && code <= maximum)
}
function validateGroupNumber(code: number, value: string) {
  const integer = inRanges(code, INTEGER_RANGES)
  if (!integer && !inRanges(code, FLOAT_RANGES)) return
  const syntax = integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
  requireImport(
    value.length <= 64 && syntax.test(value) && Number.isFinite(Number(value)),
    "invalid-format",
    "DXF numeric groups must contain complete finite values.",
  )
  if (integer)
    requireImport(
      Number.isSafeInteger(Number(value)),
      "invalid-format",
      "DXF integer groups exceed their exact range.",
    )
}
function readGroup(lines: readonly string[], index: number) {
  const codeText = lines[index]?.trim() ?? ""
  const value = lines[index + 1]?.trim() ?? ""
  requireImport(
    /^\d{1,4}$/.test(codeText) && value.length <= 4096,
    "invalid-format",
    "Invalid DXF group pair.",
  )
  const code = Number(codeText)
  requireImport(code <= 1071, "invalid-format", "DXF group code is outside its supported range.")
  validateGroupNumber(code, value)
  requireImport(
    !["__proto__", "constructor", "prototype"].includes(value),
    "unsafe-reference",
    "Unsafe DXF dictionary name.",
  )
  requireImport(
    !/^(?:https?|file|ftp|data):/i.test(value),
    "unsafe-reference",
    "External DXF references are forbidden.",
  )
  return { code, value }
}
/** Inventory entities before the upstream parser can skip unsupported types. */
export function preflightDxf(bytes: Uint8Array, limits: ImportLimits) {
  const text = decodeImportText(bytes)
  requireImport(
    !text.startsWith("AutoCAD Binary DXF"),
    "unsupported-geometry",
    "Binary DXF requires a separate parser.",
  )
  const lines = text.trimEnd().split(/\r\n|\n|\r/)
  requireImport(
    lines.length % 2 === 0,
    "invalid-format",
    "DXF group code/value pairs are truncated.",
  )
  requireImport(
    lines.length <= limits.xmlNodes * 16,
    "resource-limit",
    "DXF exceeds its group budget.",
  )
  const inventory = new DxfInventory(limits)
  for (let index = 0; index < lines.length; index += 2) {
    const { code, value } = readGroup(lines, index)
    inventory.group(code, value)
  }
  inventory.finish()
  return text
}
