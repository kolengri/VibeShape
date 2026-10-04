import { createLengthQuantity } from "../../packages/domain/src/units"

export const primitiveNames = ["box", "cylinder", "cone", "sphere", "torus", "pyramid"] as const
export type PrimitiveName = (typeof primitiveNames)[number]
export const lifecycleId = (n: number) => `0195b5ac-b290-7a2c-8c33-${String(n).padStart(12, "0")}`
export function primitiveParameters<Name extends PrimitiveName>(
  name: Name,
  scale = 1,
  expression: string | null = null,
) {
  const length = (value: number) => createLengthQuantity(value * scale, "mm", expression)
  const origin = {
    x: createLengthQuantity(20 * primitiveNames.indexOf(name)),
    y: createLengthQuantity(-3),
    z: createLengthQuantity(4),
  }
  const parameters = {
    box: { width: length(8), depth: length(6), height: length(12), centered: false, origin },
    cylinder: { radius: length(4), height: length(12), centered: true, origin },
    cone: { radius: length(4), height: length(12), centered: true, origin },
    sphere: { radius: length(4), origin },
    torus: { majorRadius: length(10), minorRadius: length(2), origin },
    pyramid: { sides: 6, radius: length(4), height: length(12), centered: false, origin },
  }
  return parameters[name]
}
export const primitiveVolumes: Record<PrimitiveName, number> = {
  box: 576,
  cylinder: 192 * Math.PI,
  cone: 64 * Math.PI,
  sphere: (256 * Math.PI) / 3,
  torus: 80 * Math.PI ** 2,
  pyramid: 96 * Math.sqrt(3),
}
