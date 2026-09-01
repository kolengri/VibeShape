import {
  booleanFeatureType,
  boxFeatureType,
  createAngleQuantity,
  createLengthQuantity,
  createSketchProfileSet,
  cylinderFeatureType,
  datumPlaneFeatureType,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  featureIdSchema,
  featureRecordSchema,
  legacyRevolveFeatureType,
  multiProfileExtrusionFeatureType,
  multiProfileRevolveFeatureType,
  revolveFeatureType,
  sketchProfileSelectorSchema,
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
  isDatumPlaneFeature,
  isExtrusionFeature,
  isRevolveFeature,
  modifyingSolidTargetFeatures,
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

const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f2801",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f2802"],
  holeBoundaryEntityIds: [],
})

const extrusion = featureRecordSchema.parse({
  ...box,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2705"),
  type: extrusionFeatureType.type,
  parameters: {
    profile,
    distance: createLengthQuantity(12),
    symmetric: false,
    operation: "new",
  },
  label: "Extrusion 1",
})

const revolve = featureRecordSchema.parse({
  ...box,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2707"),
  type: revolveFeatureType.type,
  parameters: {
    profile,
    axis: { kind: "origin-axis", axis: "y" },
    angle: createAngleQuantity(180, "deg"),
    operation: "new",
  },
  label: "Revolve 1",
})

const secondProfile = sketchProfileSelectorSchema.parse({
  ...profile,
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f2803"],
})

const multiProfileExtrusion = featureRecordSchema.parse({
  ...extrusion,
  type: multiProfileExtrusionFeatureType.type,
  parameters: {
    profiles: createSketchProfileSet([profile, secondProfile]),
    distance: createLengthQuantity(12),
    symmetric: false,
    operation: "new",
  },
})

const modifyingMultiProfileExtrusion = featureRecordSchema.parse({
  ...multiProfileExtrusion,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2708"),
  type: extrusionFeatureTypeV4.type,
  parameters: {
    ...multiProfileExtrusion.parameters,
    operation: "remove",
  },
  dependencies: [box.id],
})

const multiProfileRevolve = featureRecordSchema.parse({
  ...revolve,
  type: multiProfileRevolveFeatureType.type,
  parameters: {
    profiles: createSketchProfileSet([profile, secondProfile]),
    axis: { kind: "origin-axis", axis: "y" },
    angle: createAngleQuantity(180, "deg"),
    operation: "new",
  },
})

const dependentBoolean = featureRecordSchema.parse({
  ...boolean,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2704"),
  dependencies: [boolean.id, cylinder.id],
  label: "Subtract 2",
})

const datumPlane = featureRecordSchema.parse({
  ...box,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2706"),
  type: datumPlaneFeatureType.type,
  parameters: {
    mode: "offset",
    support: { kind: "origin-plane", plane: "xy" },
    offset: createLengthQuantity(10),
  },
  label: "Datum plane 1",
})

describe("part-design tool routing", () => {
  it("matches feature types by their full contribution identity", () => {
    expect(isBoxFeature(box)).toBe(true)
    expect(isCylinderFeature(box)).toBe(false)
    expect(isBoxFeature(cylinder)).toBe(false)
    expect(isCylinderFeature(cylinder)).toBe(true)
    expect(isBooleanFeature(boolean)).toBe(true)
    expect(isExtrusionFeature(extrusion)).toBe(true)
    expect(isExtrusionFeature(multiProfileExtrusion)).toBe(true)
    expect(isExtrusionFeature(modifyingMultiProfileExtrusion)).toBe(true)
    expect(isRevolveFeature(revolve)).toBe(true)
    expect(isRevolveFeature(multiProfileRevolve)).toBe(true)
    expect(isDatumPlaneFeature(datumPlane)).toBe(true)
  })

  it("derives the active command and optional edit feature identity", () => {
    expect(activePartDesignCommand({ kind: "create-box" })).toBe("box")
    expect(activePartDesignCommand({ kind: "edit-cylinder", featureId })).toBe("cylinder")
    expect(activePartDesignCommand({ kind: "create-subtract" })).toBe("subtract")
    expect(activePartDesignCommand({ kind: "edit-extrusion", featureId })).toBe("extrusion")
    expect(activePartDesignCommand({ kind: "create-datum-plane" })).toBe("datum-plane")
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
    expect(editPartDesignTool(multiProfileExtrusion)).toEqual({
      kind: "edit-extrusion",
      featureId: multiProfileExtrusion.id,
    })
    expect(editPartDesignTool(multiProfileRevolve)).toEqual({
      kind: "edit-revolve",
      featureId: multiProfileRevolve.id,
    })
    expect(editPartDesignTool(datumPlane)).toEqual({
      kind: "edit-datum-plane",
      featureId: datumPlane.id,
    })
    expect(editPartDesignTool(undefined)).toBeNull()
  })

  it("excludes the edited Boolean and all of its dependents from input candidates", () => {
    expect(
      booleanInputFeatures([box, cylinder, extrusion, boolean, dependentBoolean, datumPlane]),
    ).toEqual([box, cylinder, extrusion, boolean, dependentBoolean])
    expect(
      booleanInputFeatures([box, cylinder, extrusion, boolean, dependentBoolean], boolean.id),
    ).toEqual([box, cylinder, extrusion])
    expect(
      booleanInputFeatures([
        multiProfileExtrusion,
        modifyingMultiProfileExtrusion,
        multiProfileRevolve,
      ]),
    ).toEqual([modifyingMultiProfileExtrusion])
  })

  it("offers only terminal solids as extrusion targets while retaining the edited target", () => {
    expect(modifyingSolidTargetFeatures([box, cylinder, extrusion, boolean])).toEqual([
      extrusion,
      boolean,
    ])
    expect(modifyingSolidTargetFeatures([box, cylinder, extrusion, boolean], boolean.id)).toEqual([
      box,
      cylinder,
      extrusion,
    ])
    expect(
      modifyingSolidTargetFeatures([
        multiProfileExtrusion,
        modifyingMultiProfileExtrusion,
        multiProfileRevolve,
      ]),
    ).toEqual([modifyingMultiProfileExtrusion])
  })

  it("keeps schema-version-1 revolve records editable and target-eligible", () => {
    const legacyRevolve = featureRecordSchema.parse({
      ...revolve,
      type: legacyRevolveFeatureType.type,
    })

    expect(isRevolveFeature(legacyRevolve)).toBe(true)
    expect(editPartDesignTool(legacyRevolve)).toEqual({
      kind: "edit-revolve",
      featureId: legacyRevolve.id,
    })
    expect(modifyingSolidTargetFeatures([legacyRevolve])).toEqual([legacyRevolve])
  })

  it("keeps support-only dependencies independent from body terminality", () => {
    const supportedNewBody = featureRecordSchema.parse({
      ...revolve,
      dependencies: [box.id],
    })
    const modifyingRevolve = featureRecordSchema.parse({
      ...revolve,
      parameters: { ...revolve.parameters, operation: "add" },
      dependencies: [cylinder.id, box.id],
    })

    expect(modifyingSolidTargetFeatures([box, supportedNewBody])).toEqual([box, supportedNewBody])
    expect(modifyingSolidTargetFeatures([box, cylinder, modifyingRevolve])).toEqual([
      box,
      modifyingRevolve,
    ])
    expect(
      modifyingSolidTargetFeatures([box, cylinder, modifyingRevolve], modifyingRevolve.id),
    ).toEqual([box, cylinder])
  })
})
