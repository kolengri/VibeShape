import { describe, expect, it } from "bun:test"
import { boxFeatureType, createLengthQuantity, featureRecordSchema } from "@vibeshape/domain"
import {
  mirrorFeatureType,
  mirrorFeatureTypeV2,
  mirrorFeatureTypeV3,
} from "@vibeshape/domain/part-design-mirror"
import {
  activeFeatureId,
  activePartDesignCommand,
  editPartDesignTool,
  modifyingSolidTargetFeatures,
} from "../part-design/part-design-tool"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7801"
const mirrorId = "0195b5ac-b220-7a2c-8c33-67a36a7f7802"
const source = featureRecordSchema.parse({
  schemaVersion: 0,
  id: sourceId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20),
    depth: createLengthQuantity(30),
    height: createLengthQuantity(40),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
})
function mirror(version2: boolean, preserveSource = false) {
  return featureRecordSchema.parse({
    ...source,
    id: mirrorId,
    type: version2 ? mirrorFeatureTypeV2.type : mirrorFeatureType.type,
    parameters: {
      targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
      plane: "XY",
      ...(version2 ? { offset: createLengthQuantity(-10), preserveSource } : {}),
    },
    dependencies: [sourceId],
  })
}
describe("Mirror history activation and downstream selection", () => {
  it.each([false, true])("opens the supported Mirror contract from History (v2=%s)", (version2) => {
    const tool = editPartDesignTool(mirror(version2))
    expect(tool).toEqual<unknown>({ kind: "edit-mirror", featureId: mirrorId })
    expect(activeFeatureId(tool)).toBe<unknown>(mirrorId)
    expect(activePartDesignCommand(tool)).toBe("mirror")
  })
  it("offers both source and reflected copy for downstream solid operations", () => {
    expect(
      modifyingSolidTargetFeatures([source, mirror(true, true)]).map(({ id }) => id),
    ).toEqual<unknown>([sourceId, mirrorId])
    expect(
      modifyingSolidTargetFeatures([source, mirror(true, false)]).map(({ id }) => id),
    ).toEqual<unknown>([mirrorId])
  })
  it("routes v3 arbitrary-plane intent while retaining a source-preserving copy downstream", () => {
    const legacy = mirror(true, true)
    const feature = featureRecordSchema.parse({
      ...legacy,
      type: mirrorFeatureTypeV3.type,
      parameters: {
        ...legacy.parameters,
        plane: { kind: "explicit-plane", origin: [3, 4, 5], normal: [0.6, 0.8, 0] },
      },
    })
    expect(editPartDesignTool(feature)).toEqual<unknown>({
      kind: "edit-mirror",
      featureId: mirrorId,
    })
    expect(modifyingSolidTargetFeatures([source, feature]).map(({ id }) => id)).toEqual<unknown>([
      sourceId,
      mirrorId,
    ])
  })
  it("does not route unsupported future Mirror contracts to the current form", () => {
    const feature = mirror(true)
    expect(
      editPartDesignTool({ ...feature, type: { ...feature.type, schemaVersion: 4 } }),
    ).toBeNull()
  })
})
