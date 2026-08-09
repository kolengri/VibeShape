import {
  boxFeatureType,
  createLengthQuantity,
  cylinderFeatureType,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  activeFeatureId,
  activePrimitiveCommand,
  isBoxFeature,
  isCylinderFeature,
} from "./part-design-tool"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2701")

const box = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(10),
    depth: createLengthQuantity(20),
    height: createLengthQuantity(30),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
})

const cylinder = featureRecordSchema.parse({
  ...box,
  type: cylinderFeatureType.type,
  parameters: {
    radius: createLengthQuantity(10),
    height: createLengthQuantity(30),
    centered: true,
  },
  label: "Cylinder 1",
})

describe("part-design tool routing", () => {
  it("matches feature types by their full contribution identity", () => {
    expect(isBoxFeature(box)).toBe(true)
    expect(isCylinderFeature(box)).toBe(false)
    expect(isBoxFeature(cylinder)).toBe(false)
    expect(isCylinderFeature(cylinder)).toBe(true)
  })

  it("derives the active command and optional edit feature identity", () => {
    expect(activePrimitiveCommand({ kind: "create-box" })).toBe("box")
    expect(activePrimitiveCommand({ kind: "edit-cylinder", featureId })).toBe("cylinder")
    expect(activeFeatureId({ kind: "edit-cylinder", featureId })).toBe(featureId)
    expect(activeFeatureId({ kind: "create-cylinder" })).toBeNull()
    expect(activePrimitiveCommand(null)).toBeNull()
  })
})
