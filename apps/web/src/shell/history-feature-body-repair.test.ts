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
import { draftFeatureType } from "@vibeshape/domain/part-design-draft"
import { mirrorFeatureTypeV2, mirrorFeatureTypeV3 } from "@vibeshape/domain/part-design-mirror"
import { patternFeatureType } from "@vibeshape/domain/part-design-pattern"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { scaleFeatureType } from "@vibeshape/domain/part-design-scale"
import { shellFeatureType } from "@vibeshape/domain/part-design-shell"
import { splitFeatureType } from "@vibeshape/domain/part-design-split"
import { thickenFeatureType } from "@vibeshape/domain/part-design-thicken"
import { threadFeatureType } from "@vibeshape/domain/part-design-thread"
import {
  draftFormFeature,
  draftInitialNeutralPlane,
  draftInitialSelection,
  draftTargetBody,
} from "../features/draft/draft-form-model"
import { shellFormFeature, shellInitialValues } from "../features/shell/shell-form-model"
import {
  thickenFormFeature,
  thickenInitialSelection,
  thickenTargetBody,
} from "../features/thicken/thicken-form-model"
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
const neutralFace = {
  ...opening,
  semanticRole: "bottom",
  signature: {
    ...opening.signature,
    centroid: [0, 0, 0] as [number, number, number],
    bounds: {
      min: [-5, -5, 0] as [number, number, number],
      max: [5, 5, 0] as [number, number, number],
    },
    direction: [0, 0, -1] as [number, number, number],
  },
}

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
      "Scale",
      feature(scaleFeatureType.type, {
        targetBody,
        factor: createScalarQuantity(2, "1 + 1"),
        center: { kind: "origin" },
      }),
    ],
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

  it.each([
    [
      "an origin neutral plane",
      { kind: "origin-plane", plane: "XY" },
      { kind: "origin-plane", plane: "XY" },
    ],
    ["a neutral face of the missing body", { kind: "planar-face", reference: neutralFace }, null],
  ] as const)(
    "keeps a saved Draft and requires faces again on the replacement body with %s",
    (_name, neutralPlane, expectedPlane) => {
      const original = feature(draftFeatureType.type, {
        targetBody,
        faces: [opening],
        neutralPlane,
        angle: createAngleQuantity(5, "deg"),
        flip: false,
      })
      const adapted = replaceHistoryFeatureBody(original, missingInputs, replacement)
      if (!adapted?.faceTarget) throw new Error("Expected a Draft face-reselection adapter")
      // The saved record is not rewritten: its faces belong to the missing body.
      expect(adapted.feature).toBe(original)
      expect(adapted.faceTarget).toEqual(replacement)
      const mode = { kind: "edit" as const, feature: original, repairTarget: adapted.faceTarget }
      expect(draftTargetBody(mode)).toEqual(replacement)
      expect(draftInitialNeutralPlane(mode)).toEqual(expectedPlane)
      const replacementEvidence = {
        ...evidence,
        featureId: replacementId,
        outputRole: replacement.outputRole,
      }
      expect(draftInitialSelection(mode, replacementEvidence)).toEqual({
        repair: true,
        faceIds: [],
      })
      // Apply saves only a complete selection on the replacement body.
      const save = (faceIds: string[], plane: typeof expectedPlane, source = replacementEvidence) =>
        draftFormFeature({
          mode,
          featureId,
          values: { faceIds, angle: "5 deg", flip: false },
          neutralPlane: plane,
          evidence: source,
          variables: [],
          units: { length: "mm", angle: "deg" },
          copy: { invalidExpression: "", invalidDimension: "", invalidRange: "" },
        })
      const plane = expectedPlane ?? ({ kind: "origin-plane", plane: "XY" } as const)
      expect(save([], plane)).toBeNull()
      expect(save(["face:top"], null)).toBeNull()
      expect(save(["face:top"], plane, evidence)).toBeNull()
      const saved = save(["face:top"], plane)
      expect(saved).toMatchObject({
        id: featureId,
        dependencies: [replacementId],
        parameters: { targetBody: replacement, flip: false },
      })
      expect(JSON.stringify(saved)).not.toContain(sourceId)
    },
  )

  it("keeps a saved Thicken and requires faces again on the replacement body", () => {
    const original = feature(thickenFeatureType.type, {
      targetBody,
      faces: [opening],
      thickness: length(2),
      side: "symmetric",
      operation: "add",
    })
    expect(missingHistoryFeatureBody(original, missingInputs)).toEqual(targetBody)
    const adapted = replaceHistoryFeatureBody(original, missingInputs, replacement)
    if (!adapted?.faceTarget) throw new Error("Expected a Thicken face-reselection adapter")
    expect(adapted.feature).toBe(original)
    const mode = { kind: "edit" as const, feature: original, repairTarget: adapted.faceTarget }
    expect(thickenTargetBody(mode)).toEqual(replacement)
    const replacementEvidence = {
      ...evidence,
      featureId: replacementId,
      outputRole: replacement.outputRole,
    }
    expect(thickenInitialSelection(mode, replacementEvidence)).toEqual({
      repair: true,
      faceIds: [],
    })
    const save = (faceIds: string[]) =>
      thickenFormFeature({
        mode,
        featureId,
        values: { faceIds, thickness: "2 mm", side: "symmetric", operation: "add" },
        evidence: replacementEvidence,
        variables: [],
        units: { length: "mm", angle: "deg" },
        copy: { invalidExpression: "", invalidDimension: "", invalidRange: "" },
      })
    expect(save([])).toBeNull()
    const saved = save(["face:top"])
    expect(saved).toMatchObject({
      dependencies: [replacementId],
      parameters: { targetBody: replacement, side: "symmetric", operation: "add" },
    })
    expect(JSON.stringify(saved)).not.toContain(sourceId)
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
