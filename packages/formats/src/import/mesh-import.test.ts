import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { BufferGeometry, Float32BufferAttribute, Mesh } from "three"
import { STLExporter } from "three/addons/exporters/STLExporter.js"
import { describe, expect, it } from "vitest"
import { writeThreeMf } from "../three-mf"
import { parseGeometryImport } from "./index"

const vertices: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const triangles: [number, number, number][] = [
  [0, 2, 1],
  [0, 1, 3],
  [0, 3, 2],
  [1, 2, 3],
]
function nativeArchive() {
  return writeThreeMf({
    schemaVersion: 1,
    language: "en-US",
    objects: [
      { kind: "mesh", id: 1, name: "Tetrahedron", mesh: { vertices, triangles } },
      {
        kind: "components",
        id: 2,
        components: [{ objectId: 1, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 0] }],
      },
      { kind: "components", id: 3, components: [{ objectId: 2 }] },
    ],
    build: [{ objectId: 3, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 0] }],
  }).bytes
}
function changeModel(change: (xml: string) => string, additional: Record<string, Uint8Array> = {}) {
  const files = unzipSync(nativeArchive())
  files["3D/3dmodel.model"] = strToU8(change(strFromU8(files["3D/3dmodel.model"] as Uint8Array)))
  return zipSync({ ...files, ...additional }, { level: 0 })
}
function binaryTriangle() {
  const bytes = new Uint8Array(134)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, 1, true)
  const data = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
  data.forEach((value, index) => {
    view.setFloat32(84 + index * 4, value, true)
  })
  return bytes
}
describe("bounded mesh import", () => {
  it("reads independent Three STL writer output in binary and ASCII without mutating bytes", async () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        triangles.flatMap((face) =>
          face.flatMap((index) => vertices[index] as [number, number, number]),
        ),
        3,
      ),
    )
    const mesh = new Mesh(geometry)
    mesh.position.set(2, 3, 4)
    mesh.updateMatrixWorld(true)
    const exporter = new STLExporter()
    const binary = exporter.parse(mesh, { binary: true })
    const fixtures = [
      new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength),
      strToU8(exporter.parse(mesh, { binary: false })),
    ]
    for (const bytes of fixtures) {
      const before = bytes.slice()
      const result = await parseGeometryImport({ format: "stl", bytes, units: "in" })
      expect(result.ok).toBe(true)
      if (!result.ok || result.geometry.kind !== "triangle-mesh") throw new Error("Expected mesh")
      expect(result.geometry.meshes[0]?.triangles).toHaveLength(4)
      expect(result.geometry.meshes[0]?.vertices[0]).toEqual([50.8, 76.19999999999999, 101.6])
      expect(result.geometry.units).toMatchObject({ millimetersPerUnit: 25.4, policy: "selected" })
      expect(bytes).toEqual(before)
    }
    geometry.dispose()
  })
  it("round trips the native 3MF writer with nested components and absolute placement", async () => {
    const result = await parseGeometryImport({ format: "3mf", bytes: nativeArchive() })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "triangle-mesh") throw new Error("Expected mesh")
    expect(result.geometry.meshes[0]).toMatchObject({ vertices, triangles, label: "Tetrahedron" })
    expect(result.geometry.nodes[0]?.transform.slice(12, 15)).toEqual([15, 20, 0])
    expect(result.geometry.nodes[0]?.reversesWinding).toBe(false)
  })
  it("rejects open, inconsistently oriented and zero-volume 3MF model resources", async () => {
    const mutations = [
      (xml: string) => xml.replace(/<triangle v1="1" v2="2" v3="3" \/>/, ""),
      (xml: string) =>
        xml.replace('<triangle v1="0" v2="2" v3="1" />', '<triangle v1="0" v2="1" v3="2" />'),
      (xml: string) => xml.replace('x="0" y="0" z="1"', 'x="0" y="0" z="0"'),
    ]
    for (const mutate of mutations) {
      const result = await parseGeometryImport({ format: "3mf", bytes: changeModel(mutate) })
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry" } })
    }
  })
  it("normalizes declared 3MF units and retains mirrored winding explicitly", async () => {
    const bytes = changeModel((xml) =>
      xml
        .replace('unit="millimeter"', 'unit="inch"')
        .replace('transform="1 0 0 0 1 0 0 0 1 5 0 0"', 'transform="-1 0 0 0 1 0 0 0 1 5 0 0"'),
    )
    const result = await parseGeometryImport({ format: "3mf", bytes })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "triangle-mesh") throw new Error("Expected mesh")
    expect(result.geometry.meshes[0]?.vertices[1]).toEqual([25.4, 0, 0])
    expect(result.geometry.nodes[0]?.transform.slice(12, 15)).toEqual([-127, 508, 0])
    expect(result.geometry.nodes[0]?.reversesWinding).toBe(true)
  })
  it.each([
    ["truncated", (bytes: Uint8Array) => bytes.slice(0, -1), "invalid-format"],
    [
      "NaN",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setFloat32(96, NaN, true)
        return bytes
      },
      "invalid-geometry",
    ],
    [
      "empty",
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint32(80, 0, true)
        return bytes.slice(0, 84)
      },
      "invalid-geometry",
    ],
    [
      "degenerate",
      (bytes: Uint8Array) => {
        bytes.fill(0, 96, 132)
        return bytes
      },
      "invalid-geometry",
    ],
  ])("rejects %s STL", async (_name, change, code) => {
    const result = await parseGeometryImport({
      format: "stl",
      bytes: change(binaryTriangle()),
      units: "mm",
    })
    expect(result).toMatchObject({ ok: false, diagnostic: { code } })
  })
  it("retains mixed degenerate faces with an explicit warning", async () => {
    const bytes = new Uint8Array(184)
    bytes.set(binaryTriangle())
    new DataView(bytes.buffer).setUint32(80, 2, true)
    const result = await parseGeometryImport({ format: "stl", bytes, units: "mm" })
    expect(result).toMatchObject({
      ok: true,
      geometry: { warnings: [{ code: "degenerate-triangles", count: 1 }] },
    })
  })
  it.each([
    [
      "cycle",
      (xml: string) => xml.replace('component objectid="2"', 'component objectid="3"'),
      "invalid-geometry",
    ],
    [
      "missing object",
      (xml: string) => xml.replace('component objectid="2"', 'component objectid="99"'),
      "invalid-geometry",
    ],
    ["vertex index", (xml: string) => xml.replace('v1="0"', 'v1="99"'), "invalid-geometry"],
    [
      "singular transform",
      (xml: string) =>
        xml.replace('transform="1 0 0 0 1 0 0 0 1 5 0 0"', 'transform="0 0 0 0 0 0 0 0 0 5 0 0"'),
      "invalid-geometry",
    ],
    [
      "required extension",
      (xml: string) =>
        xml.replace("<model ", '<model requiredextensions="x" xmlns:x="urn:unsupported" '),
      "unsupported-geometry",
    ],
    [
      "DTD",
      (xml: string) =>
        xml.replace("<model ", '<!DOCTYPE model [<!ENTITY x SYSTEM "file:///secret">]><model '),
      "unsafe-reference",
    ],
  ])("rejects 3MF %s", async (_name, change, code) => {
    const result = await parseGeometryImport({ format: "3mf", bytes: changeModel(change) })
    expect(result).toMatchObject({ ok: false, diagnostic: { code } })
  })
  it("rejects ZIP traversal, unsupported entries and external relationships", async () => {
    expect(
      await parseGeometryImport({
        format: "3mf",
        bytes: changeModel((xml) => xml, { "../escape": strToU8("x") }),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsafe-reference" } })
    expect(
      await parseGeometryImport({
        format: "3mf",
        bytes: changeModel((xml) => xml, { "3D/extra.model": strToU8("x") }),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsupported-geometry" } })
    const files = unzipSync(nativeArchive())
    files["_rels/.rels"] = strToU8(
      strFromU8(files["_rels/.rels"] as Uint8Array).replace(
        'Target="/3D/3dmodel.model"',
        'Target="https://example.test/model" TargetMode="External"',
      ),
    )
    expect(
      await parseGeometryImport({ format: "3mf", bytes: zipSync(files, { level: 0 }) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsafe-reference" } })
  })
  it("enforces reduced budgets before mesh and archive expansion", async () => {
    expect(
      await parseGeometryImport({
        format: "stl",
        bytes: binaryTriangle(),
        units: "mm",
        limits: { vertices: 2 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
    expect(
      await parseGeometryImport({
        format: "3mf",
        bytes: nativeArchive(),
        limits: { zipEntries: 2 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
    expect(
      await parseGeometryImport({ format: "3mf", bytes: nativeArchive(), limits: { xmlNodes: 5 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
    expect(
      await parseGeometryImport({
        format: "3mf",
        bytes: nativeArchive(),
        limits: { blockDepth: 2 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
  })
  it("shares the XML-node budget across all package parts and rejects ZIP symlinks", async () => {
    expect(
      await parseGeometryImport({
        format: "3mf",
        bytes: nativeArchive(),
        limits: { xmlNodes: 40 },
      }),
    ).toMatchObject({ ok: true })
    const bytes = changeModel((xml) => xml, {
      "Metadata/extra.xml": strToU8(`<m>${"<n/>".repeat(20)}</m>`),
    })
    expect(
      await parseGeometryImport({ format: "3mf", bytes, limits: { xmlNodes: 40 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
    const symlink = nativeArchive().slice()
    const view = new DataView(symlink.buffer)
    for (let index = 0; index < symlink.length - 46; index++)
      if (view.getUint32(index, true) === 0x02014b50) {
        view.setUint16(index + 4, 0x0314, true)
        view.setUint32(index + 38, 0xa1ff0000, true)
        break
      }
    expect(await parseGeometryImport({ format: "3mf", bytes: symlink })).toMatchObject({
      ok: false,
      diagnostic: { code: "unsafe-reference" },
    })
  })
  it("rejects suspicious ZIP ratios and unused cyclic resources", async () => {
    const files = unzipSync(nativeArchive())
    files["Metadata/large.txt"] = strToU8("x".repeat(100000))
    expect(
      await parseGeometryImport({ format: "3mf", bytes: zipSync(files, { level: 9 }) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
    const bytes = changeModel((xml) =>
      xml.replace(
        "</resources>",
        '<object id="4" type="model"><components><component objectid="4"/></components></object></resources>',
      ),
    )
    expect(await parseGeometryImport({ format: "3mf", bytes })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry" },
    })
  })
})
