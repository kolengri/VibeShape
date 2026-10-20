import { describe, expect, it } from "bun:test"
import {
  booleanFeatureType,
  boxFeatureType,
  chamferFeatureTypeV3,
  coneFeatureType,
  createAngleQuantity,
  createLengthQuantity,
  createSketchProfileSet,
  cylinderFeatureType,
  datumPlaneFeatureType,
  datumPlaneFeatureTypeV1,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  featureIdSchema,
  featureRecordSchema,
  legacyRevolveFeatureType,
  multiProfileExtrusionFeatureType,
  multiProfileRevolveFeatureType,
  pyramidFeatureType,
  revolveFeatureType,
  revolveFeatureTypeV6,
  sketchProfileSelectorSchema,
  sphereFeatureType,
  torusFeatureType,
} from "@vibeshape/domain"
import {
  compoundFeatureType,
  unionFeatureType,
} from "@vibeshape/domain/part-design-body-combination"
import { importedFeatureType } from "@vibeshape/domain/part-design-import"
import { meshImportFeatureType } from "@vibeshape/domain/part-design-mesh-import"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import {
  activeFeatureId,
  activePartDesignCommand,
  booleanInputFeatures,
  editPartDesignTool,
  isBooleanFeature,
  isBoxFeature,
  isConeFeature,
  isCylinderFeature,
  isDatumPlaneFeature,
  isExtrusionFeature,
  isPrimitivePartDesignTool,
  isPyramidFeature,
  isRevolveFeature,
  isSphereFeature,
  isTorusFeature,
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

const modifyingMultiProfileRevolve = featureRecordSchema.parse({
  ...multiProfileRevolve,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2709"),
  type: revolveFeatureTypeV6.type,
  parameters: { ...multiProfileRevolve.parameters, operation: "remove" },
  dependencies: [box.id],
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
  it.each([datumPlaneFeatureTypeV1, datumPlaneFeatureType])(
    "routes datum v$type.schemaVersion to its edit tool",
    (descriptor) => {
      const plane = { ...datumPlane, type: descriptor.type }
      expect(isDatumPlaneFeature(plane)).toBe(true)
      expect(editPartDesignTool(plane)).toEqual({
        kind: "edit-datum-plane",
        featureId: plane.id,
      })
    },
  )

  it("edits independent extents and excludes ambiguous new multi-solid targets", () => {
    const single = featureRecordSchema.parse({
      ...extrusion,
      type: extrusionFeatureTypeV5.type,
      parameters: {
        profiles: createSketchProfileSet([profile]),
        distance: createLengthQuantity(10),
        secondDistance: createLengthQuantity(3),
        reversed: true,
        symmetric: false,
        operation: "new",
      },
    })
    const multi = featureRecordSchema.parse({
      ...single,
      parameters: {
        ...single.parameters,
        profiles: createSketchProfileSet([profile, secondProfile]),
      },
    })
    expect(isExtrusionFeature(single)).toBe(true)
    expect(editPartDesignTool(single)).toEqual({ kind: "edit-extrusion", featureId: single.id })
    expect(editPartDesignTool(multi)).toEqual({ kind: "edit-extrusion", featureId: multi.id })
    expect(booleanInputFeatures([single])).toEqual([single])
    expect(booleanInputFeatures([multi])).toEqual([])
    expect(modifyingSolidTargetFeatures([multi])).toEqual([])
  })

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
    expect(isRevolveFeature(modifyingMultiProfileRevolve)).toBe(true)
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

  it("offers current Boolean inputs and preserves both edited inputs without descendants", () => {
    expect(
      booleanInputFeatures([box, cylinder, extrusion, boolean, dependentBoolean, datumPlane]),
    ).toEqual([extrusion, dependentBoolean])
    expect(
      booleanInputFeatures([box, cylinder, extrusion, boolean, dependentBoolean], boolean.id),
    ).toEqual([box, cylinder, extrusion])
    expect(
      booleanInputFeatures([
        multiProfileExtrusion,
        modifyingMultiProfileExtrusion,
        multiProfileRevolve,
        modifyingMultiProfileRevolve,
      ]),
    ).toEqual([modifyingMultiProfileExtrusion, modifyingMultiProfileRevolve])
  })

  it("keeps retained tools selectable and restores consumed inputs after suppression", () => {
    const retained = { ...boolean, parameters: { operation: "subtract", keepTools: true } }
    expect(booleanInputFeatures([box, cylinder, retained])).toEqual([cylinder, retained])
    expect(booleanInputFeatures([box, cylinder, boolean])).toEqual([boolean])
    expect(booleanInputFeatures([box, cylinder, { ...boolean, suppressed: true }])).toEqual([
      box,
      cylinder,
    ])
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
        modifyingMultiProfileRevolve,
      ]),
    ).toEqual([modifyingMultiProfileExtrusion, modifyingMultiProfileRevolve])
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

describe("authored part operation routing", () => {
  it.each([importedFeatureType, meshImportFeatureType])(
    "opens captured source History entries for inspection and ordinary deletion: $type.typeId",
    (descriptor) => {
      const feature = featureRecordSchema.parse({ ...box, type: descriptor.type })
      const tool = editPartDesignTool(feature)
      expect(tool).toEqual({ kind: "inspect-imported", featureId: feature.id })
      expect(activeFeatureId(tool)).toBe(feature.id)
      expect(activePartDesignCommand(tool)).toBe("inspect-imported")
      expect(
        editPartDesignTool({ ...feature, type: { ...feature.type, schemaVersion: 999 } }),
      ).toBeNull()
    },
  )
  it("reopens exact trusted Placement, Compound, and Union versions", () => {
    for (const [descriptor, kind] of [
      [placementFeatureType, "edit-placement"],
      [compoundFeatureType, "edit-compound"],
      [unionFeatureType, "edit-union"],
    ] as const) {
      const feature = featureRecordSchema.parse({ ...box, type: descriptor.type })
      expect(editPartDesignTool(feature)).toEqual({ kind, featureId: feature.id })
      expect(
        editPartDesignTool({ ...feature, type: { ...feature.type, schemaVersion: 999 } }),
      ).toBeNull()
    }
  })
  it("admits single-result Placement and Union to modifiers while keeping Compound aggregate output excluded", () => {
    const placement = featureRecordSchema.parse({ ...box, type: placementFeatureType.type })
    const union = featureRecordSchema.parse({ ...cylinder, type: unionFeatureType.type })
    const compound = featureRecordSchema.parse({ ...boolean, type: compoundFeatureType.type })
    expect(booleanInputFeatures([placement, union])).toEqual([placement, union])
    expect(booleanInputFeatures([compound])).toEqual([])
  })
  it("excludes sources consumed by an active Compound from Subtract and modifier targets", () => {
    const compound = featureRecordSchema.parse({
      ...boolean,
      type: compoundFeatureType.type,
      parameters: {
        slots: [box, cylinder].map((source) => ({
          slotId: source.id,
          targetBody: { schemaVersion: 0, featureId: source.id, outputRole: "result" },
        })),
      },
    })
    expect(booleanInputFeatures([box, cylinder, compound])).toEqual([])
    expect(modifyingSolidTargetFeatures([box, cylinder, compound])).toEqual([])
    const suppressed = { ...compound, suppressed: true }
    expect(booleanInputFeatures([box, cylinder, suppressed])).toEqual([box, cylinder])
    expect(modifyingSolidTargetFeatures([box, cylinder, suppressed])).toEqual([box, cylinder])
  })
})

describe("basic primitive tool eligibility", () => {
  it.each([
    ["sphere", sphereFeatureType.type, isSphereFeature],
    ["cone", coneFeatureType.type, isConeFeature],
    ["pyramid", pyramidFeatureType.type, isPyramidFeature],
    ["torus", torusFeatureType.type, isTorusFeature],
  ] as const)(
    "keeps %s editable, previewable, and eligible for downstream solid tools",
    (kind, type, matches) => {
      const primitive = featureRecordSchema.parse({ ...box, type })
      const editedTool = editPartDesignTool(primitive)
      expect(matches(primitive)).toBe(true)
      expect(editedTool).toEqual({ kind: `edit-${kind}`, featureId: primitive.id })
      expect(isPrimitivePartDesignTool(editedTool)).toBe(true)
      expect(activePartDesignCommand(editedTool)).toBe(kind)
      expect(booleanInputFeatures([primitive])).toEqual([primitive])
      expect(modifyingSolidTargetFeatures([primitive])).toEqual([primitive])
      expect(
        matches(featureRecordSchema.parse({ ...primitive, type: { ...type, schemaVersion: 2 } })),
      ).toBe(false)
    },
  )
})

it("opens a saved V3 Chamfer through the ordinary edit command", () => {
  const feature = featureRecordSchema.parse({ ...box, type: chamferFeatureTypeV3.type })
  expect(editPartDesignTool(feature)).toEqual({ kind: "edit-chamfer", featureId: feature.id })
})
