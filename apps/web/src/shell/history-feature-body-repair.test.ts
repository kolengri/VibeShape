import { describe, expect, it } from "bun:test"
import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  createBodyTopologyReferenceProjector,
  modelBodyTopologyEvidenceSchema,
} from "@vibeshape/domain/model-body-topology"
import { mirrorFeatureTypeV2, mirrorFeatureTypeV3 } from "@vibeshape/domain/part-design-mirror"
import { patternFeatureType } from "@vibeshape/domain/part-design-pattern"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { shellFeatureType } from "@vibeshape/domain/part-design-shell"
import { splitFeatureType } from "@vibeshape/domain/part-design-split"
import { threadFeatureType } from "@vibeshape/domain/part-design-thread"
import { shellFormFeature, shellInitialValues } from "../features/shell/shell-form-model"
import { missingHistoryFeatureBody, replaceHistoryFeatureBody } from "./history-feature-body-repair"

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9801")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9802")
const replacementId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9803")
const targetBody: BodyReference = { schemaVersion: 0, featureId: sourceId, outputRole: "result" }
const replacement: BodyReference = {
  schemaVersion: 0,
  featureId: replacementId,
  outputRole: "pattern.instance.2",
}
const missingInputs = [{ kind: "feature" as const, id: sourceId }]
const length = (value: number, expression = `${value} mm`) =>
  createLengthQuantity(value, "mm", expression)
const origin = { x: length(0), y: length(0), z: length(0) }
function feature(type: FeatureRecord["type"], parameters: unknown) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    label: "Retained operation",
    type,
    parameters,
    dependencies: [sourceId],
    references: [],
    suppressed: false,
  })
}
const placement = feature(placementFeatureType.type, {
  targetBody,
  translation: { ...origin, x: length(25, "10 mm + 15 mm") },
  rotation: {
    x: createAngleQuantity(0, "deg"),
    y: createAngleQuantity(0, "deg"),
    z: createAngleQuantity(45, "deg", "90 deg / 2"),
  },
})
const evidence = modelBodyTopologyEvidenceSchema.parse({
  schemaVersion: 1,
  documentId: sourceId,
  revision: 1,
  generation: 1,
  rebuildId: "repair-fixture",
  featureId: sourceId,
  outputRole: "result",
  kind: "face",
  contentHash: "a".repeat(64),
  candidates: [
    {
      candidateId: "face:top",
      kind: "face",
      semanticRole: "top",
      lineageTokens: [],
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: 100,
        centroid: [0, 0, 10],
        bounds: { min: [-5, -5, 10], max: [5, 5, 10] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
        direction: [0, 0, 1],
        directionMode: "oriented",
      },
    },
  ],
})
const firstCandidate = evidence.candidates[0]
if (!firstCandidate) throw new Error("Missing fixture face")
const opening = createBodyTopologyReferenceProjector(evidence)(firstCandidate)

describe("retained body feature form adapters", () => {
  it.each([
    ["Placement", placement],
    [
      "Mirror",
      feature(mirrorFeatureTypeV2.type, {
        targetBody,
        plane: "XZ",
        offset: length(7, "3 mm + 4 mm"),
        preserveSource: true,
      }),
    ],
    [
      "Pattern",
      feature(patternFeatureType.type, {
        targetBody,
        kind: "linear",
        axis: "X",
        count: createScalarQuantity(3, "1 + 2"),
        spacing: length(7, "3 mm + 4 mm"),
      }),
    ],
    ["Split", feature(splitFeatureType.type, { targetBody, plane: "YZ", offset: length(7) })],
    [
      "Thread",
      feature(threadFeatureType.type, {
        targetBody,
        kind: "internal",
        axis: "X",
        origin,
        handedness: "left",
        nominalDiameter: length(10),
        pitch: length(2),
        length: length(6),
        depth: length(0.8),
        clearance: length(0.1),
        starts: createScalarQuantity(1),
        phase: createAngleQuantity(45, "deg"),
        runIn: length(0),
        runOut: length(0),
      }),
    ],
  ])(
    "replaces only the explicit body input of %s and retains authored identity and parameters",
    (_name, original) => {
      const adapted = replaceHistoryFeatureBody(original, missingInputs, replacement)
      expect(adapted?.feature).toEqual({
        ...original,
        dependencies: [replacementId],
        parameters: { ...original.parameters, targetBody: replacement },
      })
      expect(original.dependencies).toEqual([sourceId])
    },
  )

  it("leaves missing topology support unresolved instead of transplanting its owner or signature", () => {
    const plane = { kind: "planar-face", reference: opening }
    const original = feature(mirrorFeatureTypeV3.type, {
      targetBody,
      plane,
      offset: length(5),
      preserveSource: false,
    })
    const adapted = replaceHistoryFeatureBody(original, missingInputs, replacement)
    expect(adapted?.feature.dependencies).toEqual([replacementId, sourceId])
    expect(adapted?.feature.parameters.plane).toEqual<unknown>(plane)
  })

  it("requires new Shell openings while retaining open cavity, thickness and direction", () => {
    const original = feature(shellFeatureType.type, {
      targetBody,
      thickness: length(2, "1 mm + 1 mm"),
      direction: "outward",
      sourceContentHash: evidence.contentHash,
      openings: [opening],
    })
    const adapted = replaceHistoryFeatureBody(original, missingInputs, replacement)
    if (!adapted || adapted.shellClosed === undefined) throw new Error("Expected a Shell adapter")
    const mode = {
      kind: "edit" as const,
      feature: adapted.feature,
      repairClosed: adapted.shellClosed,
    }
    const replacementEvidence = {
      ...evidence,
      featureId: replacementId,
      outputRole: replacement.outputRole,
    }
    const units = { length: "mm", angle: "deg" } as const
    const values = shellInitialValues(mode, replacementEvidence, units)
    expect(values).toEqual({
      closed: false,
      thickness: "1 mm + 1 mm",
      direction: "outward",
      openingIds: [],
    })
    expect(adapted.feature.parameters.openings).toEqual([])
    expect(original.parameters.openings).toEqual<unknown>([opening])
    const copy = {
      invalidExpression: "Invalid",
      invalidDimension: "Invalid",
      invalidRange: "Invalid",
    }
    expect(
      shellFormFeature(mode, featureId, values, replacementEvidence, [], units, copy),
    ).toBeNull()
    const repaired = shellFormFeature(
      mode,
      featureId,
      { ...values, openingIds: ["face:top"] },
      replacementEvidence,
      [],
      units,
      copy,
    )
    expect(repaired?.id).toBe(featureId)
    expect(repaired?.parameters.openings).toMatchObject([
      { featureId: replacementId, outputRole: replacement.outputRole },
    ])
  })

  it("rejects unrelated missing inputs, self-selection and malformed exact body references", () => {
    expect(
      missingHistoryFeatureBody(placement, [
        { kind: "sketch", id: sketchIdSchema.parse(sourceId) },
      ]),
    ).toBeNull()
    expect(replaceHistoryFeatureBody(placement, [], replacement)).toBeNull()
    expect(
      replaceHistoryFeatureBody(placement, missingInputs, { ...replacement, featureId }),
    ).toBeNull()
    expect(
      replaceHistoryFeatureBody(placement, missingInputs, { ...replacement, outputRole: "Face 1" }),
    ).toBeNull()
    expect(replaceHistoryFeatureBody(placement, missingInputs, targetBody)).toBeNull()
  })
})
