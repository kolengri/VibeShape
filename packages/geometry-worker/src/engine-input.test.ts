import { describe, expect, it, vi } from "vitest"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const hash = "a".repeat(64)
const sourceFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const namedInput: FeatureEvaluationInput = {
  documentId: "body-output-document",
  featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
  contentHash: "b".repeat(64),
  content: {
    schemaVersion: 1,
    feature: {
      schemaVersion: 0,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.feature.part-design.chamfer",
        schemaVersion: 1,
      },
      parameters: { distance: 1 },
      inputs: [hash],
      inputRoles: ["result"],
      references: [],
    },
    environment: {
      schemaVersion: 0,
      hostApiVersion: "0.1.0",
      modelingTolerancePolicyVersion: 1,
      geometry: {
        adapterId: "org.vibeshape.geometry.replicad",
        adapterVersion: "test",
        kernelId: "org.opencascade.occt",
        kernelVersion: "test",
        kernelSourceRevision: null,
      },
      provider: { kind: "built-in" },
    },
  },
  dependencies: [
    {
      featureId: sourceFeatureId,
      contentHash: hash,
      outputRole: "result",
    },
  ],
  mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
}

describe("direct geometry engine input boundary", () => {
  it.each([
    { contentHash: hash },
    { contentHash: hash, outputRole: "pattern.instance.1" },
    { contentHash: "c".repeat(64), outputRole: "result" },
  ])("rejects mismatched dependency %j before kernel or cache access", async (dependency) => {
    const engine = new ReplicadGeometryEngine()
    const initialize = vi
      .spyOn(engine, "initialize")
      .mockRejectedValue(new Error("Kernel accessed"))
    const progress = vi.fn()
    const result = await engine.evaluateFeature(
      {
        ...namedInput,
        dependencies: [{ featureId: sourceFeatureId, ...dependency }],
      },
      progress,
    )
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-parameters" } })
    expect(initialize).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
    expect(engine.getHealth().ownedShapeCount).toBe(0)
  })

  it("accepts a named hole target with a whole-result support input", async () => {
    const engine = new ReplicadGeometryEngine()
    const initialize = vi.spyOn(engine, "initialize").mockResolvedValue({} as never)
    const result = await engine.evaluateFeature(
      {
        ...namedInput,
        content: {
          ...namedInput.content,
          schemaVersion: 1,
          feature: {
            ...namedInput.content.feature,
            type: {
              ...namedInput.content.feature.type,
              typeId: "org.vibeshape.feature.part-design.hole",
              schemaVersion: 2,
            },
            parameters: {
              frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
              centers: [[0, 0, 20]],
              diameter: 2,
              direction: "reverse",
              extent: "blind",
              depth: 5,
              supportInputIndex: 1,
            },
            inputs: [hash, "c".repeat(64)],
            inputRoles: ["named.target", null],
            references: [
              {
                schemaVersion: 0,
                kind: "face",
                signature: {
                  kind: "face",
                  geometryClass: "PLANE",
                  measure: 1,
                  centroid: [0, 0, 0],
                  bounds: { min: [0, 0, 0], max: [1, 1, 0] },
                  boundaryCount: 4,
                  adjacentGeometryClasses: [],
                },
                inputIndex: 1,
              },
            ],
          } as FeatureEvaluationInput["content"]["feature"],
        } as FeatureEvaluationInput["content"],
        dependencies: [
          { featureId: sourceFeatureId, contentHash: hash, outputRole: "named.target" },
          { featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3104", contentHash: "c".repeat(64) },
        ],
      },
      vi.fn(),
    )
    expect(initialize).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
  })

  it.each([
    { targetRole: "named.target", supportInputIndex: 0, supportRole: undefined },
    { targetRole: "named.target", supportInputIndex: 1, supportRole: "named.support" },
  ])(
    "rejects invalid Hole v2 target/support role combination %j before kernel access",
    async (caseInput) => {
      const engine = new ReplicadGeometryEngine()
      const initialize = vi
        .spyOn(engine, "initialize")
        .mockRejectedValue(new Error("Kernel accessed"))
      const result = await engine.evaluateFeature(
        {
          ...namedInput,
          content: {
            ...namedInput.content,
            schemaVersion: 1,
            feature: {
              ...namedInput.content.feature,
              type: {
                ...namedInput.content.feature.type,
                typeId: "org.vibeshape.feature.part-design.hole",
                schemaVersion: 2,
              },
              parameters: {
                frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
                centers: [[0, 0, 20]],
                diameter: 2,
                direction: "reverse",
                extent: "blind",
                depth: 5,
                supportInputIndex: caseInput.supportInputIndex,
              },
              inputs: caseInput.supportInputIndex === 1 ? [hash, "c".repeat(64)] : [hash],
              inputRoles:
                caseInput.supportInputIndex === 1
                  ? [caseInput.targetRole, caseInput.supportRole ?? null]
                  : [caseInput.targetRole],
              references: [],
            } as FeatureEvaluationInput["content"]["feature"],
          } as FeatureEvaluationInput["content"],
          dependencies:
            caseInput.supportInputIndex === 1
              ? [
                  {
                    featureId: sourceFeatureId,
                    contentHash: hash,
                    outputRole: caseInput.targetRole,
                  },
                  {
                    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3104",
                    contentHash: "c".repeat(64),
                    outputRole: caseInput.supportRole,
                  },
                ]
              : [
                  {
                    featureId: sourceFeatureId,
                    contentHash: hash,
                    outputRole: caseInput.targetRole,
                  },
                ],
        },
        vi.fn(),
      )
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
      expect(initialize).not.toHaveBeenCalled()
    },
  )
})
