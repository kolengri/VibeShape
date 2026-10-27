import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const meshSchema = z
  .object({
    vertices: z.array(coordinate).min(9),
    triangles: z.array(z.number().int().nonnegative()).min(3),
  })
  .strict()
  .superRefine((mesh, context) => {
    if (
      mesh.vertices.length % 3 ||
      mesh.triangles.length % 3 ||
      mesh.triangles.some((index) => index >= mesh.vertices.length / 3)
    )
      context.addIssue({
        code: "custom",
        message: "STL meshes require complete XYZ triples and bounded triangle indices.",
      })
  })
const inputSchema = z
  .array(meshSchema)
  .min(1)
  .refine(
    (meshes) => meshes.reduce((total, mesh) => total + mesh.triangles.length / 3, 0) <= 0xffff_ffff,
    "Binary STL requires a UInt32 triangle count.",
  )

/** Writes world-space triangle meshes without inventing an exact solid or changing their winding. */
export function writeStlMeshes(input: unknown): Uint8Array<ArrayBuffer> {
  const meshes = inputSchema.parse(input)
  const count = meshes.reduce((total, mesh) => total + mesh.triangles.length / 3, 0)
  const bytes = new Uint8Array(84 + count * 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, count, true)
  let offset = 84
  for (const mesh of meshes)
    for (let index = 0; index < mesh.triangles.length; index += 3) {
      // A zero normal is explicitly allowed by STL; slicers derive it from vertex winding.
      for (let corner = 0; corner < 3; corner++) {
        const vertex = mesh.triangles[index + corner]
        if (vertex === undefined) throw new Error("An STL triangle is incomplete.")
        for (let axis = 0; axis < 3; axis++)
          view.setFloat32(
            offset + 12 + corner * 12 + axis * 4,
            mesh.vertices[vertex * 3 + axis] ?? 0,
            true,
          )
      }
      offset += 50
    }
  return bytes
}
