import { describe, expect, it } from "bun:test"
import { readImportedFeatureParameters } from "@vibeshape/domain/part-design-import"
import type { F3dPreparation } from "@vibeshape/formats/f3d"
import { authorityTransactionSchema } from "../../../../../packages/application/src/authority-transaction"
import { f3dCylinderMatches } from "./f3d-authoring"
import { createImportTransaction, type PreparedImportSource } from "./import-model"
import { context, id, inspection } from "./import-test-fixtures"

function plan(): F3dPreparation {
  return {
    step: "STEP",
    sketches: [
      {
        record: 1,
        name: "Imported circle",
        curves: [{ type: "circle", center: [10, 20], radius: 5 }],
      },
    ],
    parameters: [{ name: "radius", expression: "5 mm" }],
    cylinder: { sketchRecord: 1, name: "Cylinder", x: 10, y: 20, radius: 5, distance: 20 },
    report: {
      sourceFeatures: 2,
      recoveredBodies: 1,
      editableSketches: 1,
      numericParameters: 1,
      unsupported: [],
    },
  }
}
function measuredCylinder() {
  return {
    ...inspection,
    outputs: [
      {
        ...inspection.outputs[0]!,
        signature: {
          volume: Math.PI * 25 * 20,
          area: 2 * Math.PI * 5 * 25,
          centroid: [10, 20, 10] as [number, number, number],
          bounds: {
            min: [5, 15, 0] as [number, number, number],
            max: [15, 25, 20] as [number, number, number],
          },
          faceCount: 3,
          edgeCount: 6,
        },
      },
    ],
  }
}
function source(): Extract<PreparedImportSource, { representation: "exact-solid" }> {
  return {
    representation: "exact-solid",
    filename: "cylinder.f3d",
    bytes: new Uint8Array([1, 2]),
    originalBytes: new Uint8Array([3]),
    originalByteLength: 1,
    originalDigest: "b".repeat(64),
    source: {
      digest: "a".repeat(64),
      byteLength: 2,
      format: "step",
      normalization: {
        sourceUnit: "millimeter",
        scaleToMillimeters: 1,
        normalizedUnit: "millimeter",
      },
      unitPolicy: "step-system-mm",
      readerPolicyVersion: 1,
    },
    f3d: plan(),
  }
}
describe("F3D ordinary import authoring", () => {
  it("promotes only matching analytic geometry, with correctly normalized editable values", () => {
    expect(f3dCylinderMatches(plan(), measuredCylinder())).toBe(true)
    let next = 100
    const transaction = createImportTransaction(context, source(), measuredCylinder(), "F3D", () =>
      id(next++),
    )
    expect(authorityTransactionSchema.safeParse(transaction).success).toBe(true)
    expect(transaction.commands.map((command) => command.baseRevision)).toEqual(
      transaction.commands.map((_, n) => 7 + n),
    )
    const sketch = transaction.commands.find(
      (command) => command.kind === "org.vibeshape.history.insert-sketch",
    )
    expect(
      sketch?.kind === "org.vibeshape.history.insert-sketch" &&
        sketch.payload.sketch.entities.some((entity) => entity.type === "circle"),
    ).toBe(true)
    const feature = transaction.commands.at(-1)
    expect(feature?.kind).toBe("org.vibeshape.history.insert-feature")
    if (feature?.kind !== "org.vibeshape.history.insert-feature") throw new Error("Missing feature")
    expect(feature.payload.feature.type.typeId).toBe("org.vibeshape.feature.part-design.extrusion")
    expect(feature.payload.feature.parameters.distance).toMatchObject({ value: 20, unit: "mm" })
    expect(transaction.assetBlobs[0]?.bytes).toEqual(Uint8Array.of(1, 2))
  })
  it("keeps the recovered exact feature after any geometric mismatch", () => {
    const measured = measuredCylinder()
    measured.outputs[0]!.signature.centroid[2] = 10.01
    expect(f3dCylinderMatches(plan(), measured)).toBe(false)
    let next = 100
    const transaction = createImportTransaction(context, source(), measured, "F3D", () =>
      id(next++),
    )
    const feature = transaction.commands.at(-1)
    if (feature?.kind !== "org.vibeshape.history.insert-feature") throw new Error("Missing feature")
    expect(readImportedFeatureParameters(feature.payload.feature)?.source.format).toBe("step")
  })
  it("does not promote multiple bodies or nonanalytic topology despite matching other numbers", () => {
    const measured = measuredCylinder()
    measured.outputs[0]!.signature.edgeCount = 7
    expect(f3dCylinderMatches(plan(), measured)).toBe(false)
    const duplicate = measuredCylinder()
    duplicate.outputs.push(duplicate.outputs[0]!)
    expect(f3dCylinderMatches(plan(), duplicate)).toBe(false)
  })
})
