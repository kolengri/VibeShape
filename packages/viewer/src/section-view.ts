import { Plane, Vector3 } from "three"

export type ViewerSection = Readonly<{ axis: "x" | "y" | "z"; offset: number; flipped: boolean }>

export function sectionClipPlanes(section: ViewerSection | null): Plane[] | null {
  if (!section) return null
  if (
    !["x", "y", "z"].includes(section.axis) ||
    typeof section.flipped !== "boolean" ||
    !Number.isFinite(section.offset) ||
    Math.abs(section.offset) > 100_000
  ) {
    throw new Error("Invalid section plane.")
  }
  const sign = section.flipped ? 1 : -1
  const normal = new Vector3().setComponent({ x: 0, y: 1, z: 2 }[section.axis], sign)
  return [new Plane(normal, -section.offset * sign)]
}

export function sectionPointVisible(planes: readonly Plane[] | null, point: Vector3) {
  return !planes || planes.every((plane) => plane.distanceToPoint(point) >= 0)
}
