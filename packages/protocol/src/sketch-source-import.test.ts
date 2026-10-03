import { describe, expect, it } from "vitest"
import { sketchWireRecordSchema } from "./sketch"
import { sketchSourceImportWireSchema } from "./sketch-source-import"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const sourceImport = {
  schemaVersion: 0,
  assetId: id(10),
  digest: "a".repeat(64),
  byteLength: 100,
  format: "dxf",
  normalization: { sourceUnit: "inch", scaleToMillimeters: 25.4, normalizedUnit: "millimeter" },
  parserPolicyVersion: 1,
  paths: [
    {
      outputId: id(11),
      sourceOrdinal: 0,
      label: "CUT",
      closed: false,
      pointIds: [id(2), id(3)],
      curves: [{ sourceOrdinal: 0, sourceDirection: -1, curveId: id(4), pointIds: [id(2), id(3)] }],
    },
  ],
}
const sketch = {
  schemaVersion: 0,
  id: id(1),
  label: "Imported line",
  plane: "yz",
  constraints: [],
  entities: [
    { schemaVersion: 0, id: id(2), type: "point", construction: false, x: 0, y: 0 },
    { schemaVersion: 0, id: id(3), type: "point", construction: false, x: 25.4, y: 0 },
    {
      schemaVersion: 0,
      id: id(4),
      type: "line",
      construction: false,
      startPointId: id(2),
      endPointId: id(3),
    },
  ],
  sourceImport,
}

describe("planar source provenance worker contract", () => {
  it("preserves exact provenance and source direction through structured clone", () => {
    const clone = JSON.parse(JSON.stringify(sketch))
    expect(sketchWireRecordSchema.parse(clone)).toEqual(sketch)
    expect(sketchSourceImportWireSchema.parse(sourceImport)).toEqual(sourceImport)
    const { sourceImport: _source, ...old } = sketch
    expect(sketchWireRecordSchema.parse(old)).not.toHaveProperty("sourceImport")
  })

  it("rejects malformed descriptors, stale entity captures and oversized metadata before deep parsing", () => {
    for (const changed of [
      { format: "stl" },
      { parserPolicyVersion: 2 },
      { normalization: { ...sourceImport.normalization, scaleToMillimeters: 0 } },
      { digest: "A".repeat(64) },
      { byteLength: 32 * 1024 * 1024 + 1 },
      { implementation: "hidden" },
    ])
      expect(sketchSourceImportWireSchema.safeParse({ ...sourceImport, ...changed }).success).toBe(
        false,
      )
    expect(sketchWireRecordSchema.safeParse({ ...sketch, entities: [] }).success).toBe(false)
    const path = sourceImport.paths[0]
    if (!path) throw new Error("Missing path fixture.")
    expect(
      sketchWireRecordSchema.safeParse({
        ...sketch,
        sourceImport: {
          ...sourceImport,
          paths: [{ ...path, curves: [{ ...path.curves[0], curveId: id(2) }] }],
        },
      }).success,
    ).toBe(false)
    const oversized = sketchSourceImportWireSchema.safeParse({
      ...sourceImport,
      paths: [{ pointIds: new Array(4991), curves: [] }],
    })
    expect(oversized.success).toBe(false)
    if (!oversized.success) expect(oversized.error.issues[0]?.message).toMatch(/budget/)
    expect(sketchSourceImportWireSchema.safeParse({ paths: new Array(1025) }).success).toBe(false)
  })
})
