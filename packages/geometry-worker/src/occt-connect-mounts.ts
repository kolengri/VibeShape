import {
  type ConnectMountsFeatureContentParameters,
  connectMountsFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { createOcctCylinder, createOcctSphere, fuseOcctShapes } from "./occt-shapes"

type Point = readonly [number, number, number]
type Edge = { start: Point; end: Point; from: number; to: number; length: number }

function connectionEdges(parameters: ConnectMountsFeatureContentParameters) {
  const points = [...parameters.points].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  const edges: Edge[] = []
  points.forEach((start, from) => {
    points.slice(from + 1).forEach((end, offset) => {
      edges.push({
        start,
        end,
        from,
        to: from + offset + 1,
        length: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
      })
    })
  })
  edges.sort((a, b) => a.length - b.length || a.from - b.from || a.to - b.to)
  if (parameters.connectionMode === "complete") return { points, edges }
  const connected = new Set([0])
  const tree: Edge[] = []
  while (connected.size < points.length) {
    const edge = edges.find(({ from, to }) => connected.has(from) !== connected.has(to))
    if (!edge) throw new Error("Mount point graph must be connected.")
    tree.push(edge)
    connected.add(edge.from)
    connected.add(edge.to)
  }
  return { points, edges: tree }
}

type ConnectMountsOperations = Readonly<{
  sphere: typeof createOcctSphere
  cylinder: typeof createOcctCylinder
  fuse: typeof fuseOcctShapes
}>

/** Each operation borrows its inputs and transfers ownership of a fresh result. */
export function createConnectMountsShapeOperations(operations: ConnectMountsOperations) {
  return (opencascade: OpenCascadeInstance, input: ConnectMountsFeatureContentParameters) => {
    const parameters = connectMountsFeatureContentParametersSchema.parse(input)
    const { points, edges } = connectionEdges(parameters)
    const owned: { result: Shape3D | null } = { result: null }
    const append = (component: Shape3D) => {
      if (!owned.result) {
        owned.result = component
        return
      }
      try {
        const next = operations.fuse(opencascade, owned.result, component)
        owned.result.delete()
        owned.result = next
      } finally {
        component.delete()
      }
    }
    try {
      for (const point of points)
        append(operations.sphere(opencascade, parameters.nodeRadius, point))
      for (const { start, end, length } of edges)
        append(
          operations.cylinder(opencascade, parameters.strutRadius, length, start, [
            (end[0] - start[0]) / length,
            (end[1] - start[1]) / length,
            (end[2] - start[2]) / length,
          ]),
        )
      if (!owned.result) throw new Error("Mount connector did not produce a solid.")
      const shape = owned.result
      owned.result = null
      return shape
    } finally {
      owned.result?.delete()
    }
  }
}

export const createOcctConnectMounts = createConnectMountsShapeOperations({
  sphere: createOcctSphere,
  cylinder: createOcctCylinder,
  fuse: fuseOcctShapes,
})
