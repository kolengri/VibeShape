import { z } from "zod"
import { writeThreeMf } from "./three-mf"

const WELD_TOLERANCE_MM = 1e-7
const finiteCoordinateSchema = z.number().finite().min(-100_000).max(100_000)

const triangleSoupSchema = z
  .object({
    name: z.string().trim().min(1).max(4_096).optional(),
    vertices: z.array(finiteCoordinateSchema).min(12).max(3_000_000),
    triangles: z.array(z.number().int().nonnegative()).min(12).max(6_000_000),
  })
  .strict()
  .superRefine((mesh, context) => {
    if (mesh.vertices.length % 3 !== 0) {
      context.addIssue({
        code: "custom",
        path: ["vertices"],
        message: "Vertices must be XYZ triples.",
      })
    }
    if (mesh.triangles.length % 3 !== 0) {
      context.addIssue({
        code: "custom",
        path: ["triangles"],
        message: "Triangle indices must be triples.",
      })
    }
    const vertexCount = mesh.vertices.length / 3
    if (mesh.triangles.some((index) => index >= vertexCount)) {
      context.addIssue({
        code: "custom",
        path: ["triangles"],
        message: "A triangle index references a missing vertex.",
      })
    }
  })

export const threeMfMeshExportInputSchema = z
  .object({
    title: z.string().trim().min(1).max(4_096),
    meshes: z.array(triangleSoupSchema).min(1).max(10_000),
  })
  .strict()

export type ThreeMfMeshExportInput = z.input<typeof threeMfMeshExportInputSchema>

function quantizedCoordinate(value: number) {
  return Math.round(value / WELD_TOLERANCE_MM)
}

function weldMesh(mesh: z.infer<typeof triangleSoupSchema>) {
  const vertices: [number, number, number][] = []
  const weldedIndexByKey = new Map<string, number>()
  const sourceToWelded: number[] = []
  for (let offset = 0; offset < mesh.vertices.length; offset += 3) {
    const vertex = [
      mesh.vertices[offset] as number,
      mesh.vertices[offset + 1] as number,
      mesh.vertices[offset + 2] as number,
    ] as [number, number, number]
    const key = vertex.map(quantizedCoordinate).join(":")
    let weldedIndex = weldedIndexByKey.get(key)
    if (weldedIndex === undefined) {
      weldedIndex = vertices.length
      weldedIndexByKey.set(key, weldedIndex)
      vertices.push(vertex)
    }
    sourceToWelded.push(weldedIndex)
  }
  const triangles: [number, number, number][] = []
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    triangles.push([
      sourceToWelded[mesh.triangles[offset] as number] as number,
      sourceToWelded[mesh.triangles[offset + 1] as number] as number,
      sourceToWelded[mesh.triangles[offset + 2] as number] as number,
    ])
  }
  return { vertices, triangles }
}

export function writeThreeMfMeshes(input: ThreeMfMeshExportInput) {
  const parsed = threeMfMeshExportInputSchema.parse(input)
  const objects = parsed.meshes.map((mesh, index) => ({
    kind: "mesh" as const,
    id: index + 1,
    ...(mesh.name ? { name: mesh.name } : {}),
    mesh: weldMesh(mesh),
  }))
  return writeThreeMf({
    schemaVersion: 1,
    language: "en-US",
    metadata: { title: parsed.title, application: "VibeShape" },
    objects,
    build: objects.map(({ id }) => ({ objectId: id })),
  })
}
