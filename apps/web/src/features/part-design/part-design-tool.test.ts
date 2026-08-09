import {
  boxFeatureType,
  booleanFeatureType,
  createLengthQuantity,
  cylinderFeatureType,
  extrusionFeatureType,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  activeFeatureId,
  activePartDesignCommand,
  booleanInputFeatures,
  editPartDesignTool,
  isBooleanFeature,
  isBoxFeature,
  isCylinderFeature,
  isExtrusionFeature,
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
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2702"),
  type: cylinderFeatureType.type,
  parameters: {
    radius: createLengthQuantity(10),
    height: createLengthQuantity(30),
    centered: true,
  },
  label: "Cylinder 1",
})

const boolean = featureRecordSchema.parse({
  ...box,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2703"),
  type: booleanFeatureType.type,
  parameters: { operation: "subtract" },
  dependencies: [box.id, cylinder.id],
  label: "Subtract 1",
})

const extrusion = featureRecordSchema.parse({
  ...box,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2705"),
  type: extrusionFeatureType.type,
  parameters: {
    profile: {
      schemaVersion: 0,
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f2801",
      outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f2802"],
      holeBoundaryEntityIds: [],
    },
    distance: createLengthQuantity(12),
    symmetric: false,
    operation: "new",
  },
  label: "Extrusion 1",
})

const dependentBoolean = featureRecordSchema.parse({
  ...boolean,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2704"),
  dependencies: [boolean.id, cylinder.id],
  label: "Subtract 2",
})

describe("part-design tool routing", () => {
  it("matches feature types by their full contribution identity", () => {
    expect(isBoxFeature(box)).toBe(true)
    expect(isCylinderFeature(box)).toBe(false)
    expect(isBoxFeature(cylinder)).toBe(false)
    expect(isCylinderFeature(cylinder)).toBe(true)
    expect(isBooleanFeature(boolean)).toBe(true)
    expect(isExtrusionFeature(extrusion)).toBe(true)
  })

  it("derives the active command and optional edit feature identity", () => {
    expect(activePartDesignCommand({ kind: "create-box" })).toBe("box")
    expect(activePartDesignCommand({ kind: "edit-cylinder", featureId })).toBe("cylinder")
    expect(activePartDesignCommand({ kind: "create-subtract" })).toBe("subtract")
    expect(activePartDesignCommand({ kind: "edit-extrusion", featureId })).toBe("extrusion")
    expect(activeFeatureId({ kind: "edit-cylinder", featureId })).toBe(featureId)
    expect(activeFeatureId({ kind: "create-cylinder" })).toBeNull()
    expect(activePartDesignCommand(null)).toBeNull()
    expect(editPartDesignTool(boolean)).toEqual({
      kind: "edit-subtract",
      featureId: boolean.id,
    })
    expect(editPartDesignTool(extrusion)).toEqual({
      kind: "edit-extrusion",
      featureId: extrusion.id,
    })
    expect(editPartDesignTool(undefined)).toBeNull()
  })

  it("excludes the edited Boolean and all of its dependents from input candidates", () => {
    expect(booleanInputFeatures([box, cylinder, extrusion, boolean, dependentBoolean])).toEqual([
      box,
      cylinder,
      extrusion,
      boolean,
      dependentBoolean,
    ])
    expect(
      booleanInputFeatures([box, cylinder, extrusion, boolean, dependentBoolean], boolean.id),
    ).toEqual([box, cylinder, extrusion])
  })
})
