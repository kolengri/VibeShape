import { describe, expect, it } from "bun:test"
import { strFromU8, unzipSync } from "fflate"
import { writeObjArchive, writeObjMeshes } from "./obj-meshes"

const tetra = {
  vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
  triangles: [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2],
}

describe("OBJ and MTL export", () => {
  const input = {
    title: "Pair",
    meshes: [
      {
        ...tetra,
        name: "Left\nbody",
        material: { color: "#FF8000", metalness: 0.5, roughness: 0.25, opacity: 1 },
      },
      {
        name: "Right",
        vertices: tetra.vertices.map((value, index) => (index % 3 === 0 ? value + 20.5 : value)),
        triangles: tetra.triangles,
      },
    ],
  }

  it("writes one object group per body with global one-based faces in millimeters", () => {
    const { obj } = writeObjMeshes(input)
    const lines = obj.trimEnd().split("\n")
    expect(lines.filter((line) => line.startsWith("v "))).toHaveLength(8)
    expect(lines.filter((line) => line.startsWith("f "))).toHaveLength(8)
    expect(lines.filter((line) => line.startsWith("o "))).toEqual(["o Left body", "o Right"])
    expect(lines).toContain("mtllib model.mtl")
    expect(lines).toContain("v 30.5 0 0")
    expect(lines).toContain("f 1 3 2")
    expect(lines).toContain("f 5 7 6")
    const faces = lines.filter((line) => line.startsWith("f ")).flatMap((line) => line.split(" "))
    expect(
      faces
        .filter((value) => value !== "f")
        .every((value) => Number(value) >= 1 && Number(value) <= 8),
    ).toBe(true)
  })

  it("assigns materials through usemtl and an MTL library of part colors", () => {
    const { obj, mtl } = writeObjMeshes(input)
    expect(obj.match(/^usemtl material_\d+$/gm)).toEqual(["usemtl material_1", "usemtl material_2"])
    expect(mtl.match(/^newmtl /gm)).toHaveLength(2)
    expect(mtl).toContain("newmtl material_1\nKa 0 0 0\nKd 1 0.501961 0\n")
    expect(mtl).toContain("Pm 0.5")
    expect(mtl).toContain("Pr 0.25")
  })

  it("packages a deterministic archive with the referenced material library", () => {
    const first = writeObjArchive(input)
    expect(first).toEqual(writeObjArchive(input))
    const files = unzipSync(first)
    expect(Object.keys(files).sort()).toEqual(["model.mtl", "model.obj"])
    expect(strFromU8(files["model.obj"] as Uint8Array)).toBe(writeObjMeshes(input).obj)
    expect(strFromU8(files["model.mtl"] as Uint8Array)).toBe(writeObjMeshes(input).mtl)
  })
})
