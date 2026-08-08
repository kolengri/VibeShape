import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import {
  THREE_MF_CORE_NAMESPACE,
  THREE_MF_MEDIA_TYPE,
  type ThreeMfTransform,
  threeMfDocumentSchema,
  writeThreeMf,
} from "./three-mf"

const cubeVertices: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
]

const cubeTriangles: Array<[number, number, number]> = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [3, 7, 6],
  [3, 6, 2],
  [0, 4, 7],
  [0, 7, 3],
  [1, 2, 6],
  [1, 6, 5],
]

const identityTransform: ThreeMfTransform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const translatedTransform: ThreeMfTransform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 0]
const onePixelPng = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0,
  0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24,
  227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

function cubeObject(id = 1) {
  return {
    kind: "mesh" as const,
    id,
    name: "Cube & <fixture>",
    partNumber: `cube-${id}`,
    mesh: { vertices: cubeVertices, triangles: cubeTriangles },
  }
}

function validDocument() {
  return {
    schemaVersion: 1 as const,
    language: "en-US",
    metadata: {
      title: 'Fixture "assembly"',
      application: "VibeShape SPK-004",
      creationDate: "2026-08-08T00:00:00Z",
    },
    objects: [
      cubeObject(),
      {
        kind: "components" as const,
        id: 2,
        name: "Placed cube",
        components: [{ objectId: 1, transform: translatedTransform }],
      },
    ],
    build: [{ objectId: 2, transform: identityTransform, partNumber: "build-item-1" }],
    thumbnail: { mediaType: "image/png" as const, data: onePixelPng },
  }
}

describe("writeThreeMf", () => {
  it("writes the required OPC parts, Core model, components, transform, and thumbnail", () => {
    const result = writeThreeMf(validDocument())
    const files = unzipSync(result.bytes)

    expect(Object.keys(files).sort()).toEqual([
      "3D/3dmodel.model",
      "Metadata/thumbnail.png",
      "[Content_Types].xml",
      "_rels/.rels",
    ])
    const model = strFromU8(files["3D/3dmodel.model"] as Uint8Array)
    const relationships = strFromU8(files["_rels/.rels"] as Uint8Array)
    const contentTypes = strFromU8(files["[Content_Types].xml"] as Uint8Array)

    expect(model).toContain(`xmlns="${THREE_MF_CORE_NAMESPACE}"`)
    expect(model).toContain('unit="millimeter"')
    expect(model).toContain('name="Cube &amp; &lt;fixture&gt;"')
    expect(model).toContain('<metadata name="Title">Fixture &quot;assembly&quot;</metadata>')
    expect(model).toContain('<component objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 0" />')
    expect(model).toContain('<item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"')
    expect(model).not.toMatch(/<!DOCTYPE|<!ENTITY/i)
    expect(relationships).toContain('Target="/3D/3dmodel.model"')
    expect(relationships).toContain('Target="/Metadata/thumbnail.png"')
    expect(contentTypes).toContain('ContentType="image/png"')
    expect(files["Metadata/thumbnail.png"]).toEqual(onePixelPng)
    expect(result.report).toEqual({
      schemaVersion: 1,
      mediaType: THREE_MF_MEDIA_TYPE,
      unit: "millimeter",
      objectCount: 2,
      meshObjectCount: 1,
      componentObjectCount: 1,
      buildItemCount: 1,
      vertexCount: 8,
      triangleCount: 12,
      hasThumbnail: true,
      archiveBytes: result.bytes.byteLength,
    })
  })

  it("produces byte-identical archives for identical semantic input", () => {
    expect(writeThreeMf(validDocument()).bytes).toEqual(writeThreeMf(validDocument()).bytes)
  })

  it("defaults the language and application without introducing a current timestamp", () => {
    const document = validDocument()
    const parsed = threeMfDocumentSchema.parse({
      ...document,
      language: undefined,
      metadata: undefined,
      thumbnail: undefined,
    })
    const model = strFromU8(unzipSync(writeThreeMf(parsed).bytes)["3D/3dmodel.model"] as Uint8Array)

    expect(parsed.language).toBe("en-US")
    expect(model).toContain('<metadata name="Application">VibeShape</metadata>')
    expect(model).not.toContain("CreationDate")
  })

  it("rejects non-finite, out-of-range, repeated, and zero-area triangle data", () => {
    const document = validDocument()
    const invalidCases = [
      { vertices: [[Number.NaN, 0, 0], ...cubeVertices.slice(1)], triangles: cubeTriangles },
      { vertices: cubeVertices, triangles: [[0, 2, 99], ...cubeTriangles.slice(1)] },
      { vertices: cubeVertices, triangles: [[0, 0, 1], ...cubeTriangles.slice(1)] },
      { vertices: cubeVertices, triangles: [[0, 1, 2], ...cubeTriangles.slice(1)] },
    ]

    for (const mesh of invalidCases) {
      expect(
        threeMfDocumentSchema.safeParse({
          ...document,
          objects: [{ ...cubeObject(), mesh }],
          build: [{ objectId: 1 }],
        }).success,
      ).toBe(false)
    }
  })

  it("rejects open, inconsistently oriented, and negative-volume model meshes", () => {
    const document = validDocument()
    const invalidTriangles = [
      cubeTriangles.slice(0, -1),
      [[0, 1, 2] as [number, number, number], ...cubeTriangles.slice(1)],
      cubeTriangles.map(
        ([first, second, third]) => [first, third, second] as [number, number, number],
      ),
    ]

    for (const triangles of invalidTriangles) {
      expect(
        threeMfDocumentSchema.safeParse({
          ...document,
          objects: [{ ...cubeObject(), mesh: { vertices: cubeVertices, triangles } }],
          build: [{ objectId: 1 }],
        }).success,
      ).toBe(false)
    }
  })

  it("rejects an inward disconnected shell even when total signed volume stays positive", () => {
    const largeVertices = cubeVertices.map(
      ([x, y, z]) => [x * 2, y * 2, z * 2] as [number, number, number],
    )
    const inwardVertices = cubeVertices.map(
      ([x, y, z]) => [x + 4, y, z] as [number, number, number],
    )
    const inwardTriangles = cubeTriangles.map(
      ([first, second, third]) => [first + 8, third + 8, second + 8] as [number, number, number],
    )
    const document = validDocument()

    expect(
      threeMfDocumentSchema.safeParse({
        ...document,
        objects: [
          {
            ...cubeObject(),
            mesh: {
              vertices: [...largeVertices, ...inwardVertices],
              triangles: [...cubeTriangles, ...inwardTriangles],
            },
          },
        ],
        build: [{ objectId: 1 }],
      }).success,
    ).toBe(false)
  })

  it("rejects duplicate, forward, missing, and singular resource references", () => {
    const document = validDocument()
    const invalidDocuments = [
      { ...document, objects: [cubeObject(), cubeObject()] },
      { ...document, objects: [document.objects[1], document.objects[0]] },
      { ...document, build: [{ objectId: 99 }] },
      {
        ...document,
        build: [{ objectId: 2, transform: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }],
      },
    ]

    for (const invalidDocument of invalidDocuments) {
      expect(threeMfDocumentSchema.safeParse(invalidDocument).success).toBe(false)
    }
  })

  it("rejects duplicate build part numbers and mismatched thumbnail bytes", () => {
    const document = validDocument()
    expect(
      threeMfDocumentSchema.safeParse({
        ...document,
        build: [
          { objectId: 2, partNumber: "duplicate" },
          { objectId: 2, partNumber: "duplicate" },
        ],
      }).success,
    ).toBe(false)
    expect(
      threeMfDocumentSchema.safeParse({
        ...document,
        thumbnail: { mediaType: "image/jpeg", data: onePixelPng },
      }).success,
    ).toBe(false)
  })

  it("rejects unsafe text, unknown fields, and orientation-reversing transforms", () => {
    const document = validDocument()
    expect(
      threeMfDocumentSchema.safeParse({
        ...document,
        metadata: { title: "unsafe\u0000text" },
      }).success,
    ).toBe(false)
    expect(threeMfDocumentSchema.safeParse({ ...document, vendorSettings: {} }).success).toBe(false)
    expect(
      threeMfDocumentSchema.safeParse({
        ...document,
        build: [{ objectId: 2, transform: [-1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }],
      }).success,
    ).toBe(false)
  })
})
