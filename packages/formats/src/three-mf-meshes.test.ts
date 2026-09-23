import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { writeThreeMfMeshes } from "./three-mf-meshes"

const faceVertices = [
  0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1,
  0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0,
  1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1,
  0, 1, 0, 0, 0, 1, 0, 1, 1,
]

describe("3MF triangle-soup export", () => {
  it("keeps support and model meshes in one build assembly without rearranging them", () => {
    const mesh = { vertices: faceVertices, triangles: Array.from({ length: 36 }, (_, i) => i) }
    const output = writeThreeMfMeshes({
      title: "Prepared print",
      meshes: [mesh, mesh],
      assembly: true,
    })
    const xml = strFromU8(unzipSync(output.bytes)["3D/3dmodel.model"] as Uint8Array)
    expect(xml).toContain('<component objectid="1"')
    expect(xml).toContain('<component objectid="2"')
    expect(xml.match(/<item objectid=/g)).toHaveLength(1)
    expect(xml).toContain('<item objectid="3"')
  })
  it("welds face-local vertices into a valid deterministic model", () => {
    const input = {
      title: "Cube",
      meshes: [
        {
          name: "Body 1",
          vertices: faceVertices,
          triangles: Array.from({ length: 12 }, (_, index) => [
            index * 3,
            index * 3 + 1,
            index * 3 + 2,
          ]).flat(),
        },
      ],
    }
    const first = writeThreeMfMeshes(input)
    const second = writeThreeMfMeshes(input)

    expect(first.bytes).toEqual(second.bytes)
    expect(first.report).toMatchObject({
      mediaType: "model/3mf",
      objectCount: 1,
      vertexCount: 8,
      triangleCount: 12,
    })
    const archive = unzipSync(first.bytes)
    expect(strFromU8(archive["3D/3dmodel.model"] as Uint8Array)).toContain(
      '<model unit="millimeter"',
    )
  })

  it("rejects missing source vertices and triangles collapsed by welding", () => {
    const triangles = Array.from({ length: 12 }, (_, index) => [
      index * 3,
      index * 3 + 1,
      index * 3 + 2,
    ]).flat()
    expect(() =>
      writeThreeMfMeshes({
        title: "Invalid index",
        meshes: [{ vertices: faceVertices, triangles: [...triangles.slice(0, -1), 36] }],
      }),
    ).toThrow("A triangle index references a missing vertex.")

    const collapsedVertices = [...faceVertices]
    collapsedVertices.splice(0, 9, 0, 0, 0, 4e-8, 0, 0, 0, 4e-8, 0)
    expect(() =>
      writeThreeMfMeshes({
        title: "Collapsed triangle",
        meshes: [{ vertices: collapsedVertices, triangles }],
      }),
    ).toThrow()
  })
})
