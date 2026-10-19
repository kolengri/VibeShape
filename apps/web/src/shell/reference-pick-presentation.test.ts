import "../../../../tests/unit/support/dom"
import { describe, expect, it } from "bun:test"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import {
  currentReferenceRebuild,
  referencePickExcludedFeatures,
  referencePickPresentation,
} from "./reference-pick-presentation"
import type { ReferencePickCandidate } from "./reference-picking"

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([42]),
}
const body: ReferencePickCandidate = {
  id: "body",
  kind: "body",
  featureId: "input",
  outputRole: "right",
}
const face: ReferencePickCandidate = {
  id: "curved-face",
  kind: "face",
  featureId: "input",
  outputRole: "right",
  meshFaceId: 42,
}
const shape = { valid: true, solidCount: 1, volume: 1 }

function state({
  evaluationRecords = [{ featureId: "input", status: "succeeded", contentHash: "a".repeat(64) }],
  bodyShape = shape,
  producerShape = shape,
  representation,
}: {
  evaluationRecords?: readonly unknown[]
  bodyShape?: typeof shape
  producerShape?: typeof shape
  representation?: string
} = {}): DocumentControllerState {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      mode: "read-write",
      snapshot: {
        id: "document",
        revision: 7,
        features: [
          { id: "descendant", dependencies: ["edit"] },
          { id: "edit", dependencies: ["input"] },
          { id: "input", dependencies: [] },
        ],
      },
      rebuild: {
        ok: true,
        response: {
          documentId: "document",
          revision: 7,
          evaluation: {
            records: evaluationRecords,
            dirtyFeatureIds: [],
            evaluatedFeatureIds: [],
            reusedFeatureIds: [],
          },
          geometry: [
            {
              featureId: "input",
              contentHash: "a".repeat(64),
              geometry: {
                mesh,
                shape: producerShape,
                representation,
                bodies: [
                  {
                    outputRole: "left",
                    mesh,
                    shape: bodyShape,
                    representation,
                    topologyCandidates: [],
                  },
                  {
                    outputRole: "right",
                    mesh,
                    shape: bodyShape,
                    representation,
                    topologyCandidates: [{ kind: "face", meshFaceId: 42 }],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  } as unknown as DocumentControllerState
}

function presentation(
  controller = state(),
  candidates: readonly ReferencePickCandidate[] = [body],
  hiddenFeatureIds: readonly string[] = [],
  overrides?: PartVisibilityOverrides,
) {
  return referencePickPresentation({
    controller,
    candidates,
    hiddenFeatureIds,
    excludedFeatureIds: referencePickExcludedFeatures(controller, "edit"),
    partVisibilityOverrides: overrides,
  })
}

describe("reference selection presentation", () => {
  it("restores only the explicitly eligible consumed edit input with its exact body role", () => {
    const result = presentation()
    expect(result.candidates.map(({ id }) => id)).toEqual(["body"])
    expect(result.meshes.map(({ featureId, outputRole }) => [featureId, outputRole])).toEqual([
      ["input", "right"],
    ])
    expect(result.meshes[0]?.positions).toBe(mesh.positions)
    expect([...referencePickExcludedFeatures(state(), "edit")].sort()).toEqual([
      "descendant",
      "edit",
    ])
  })

  it("validates transient curved-face evidence against the current exact output", () => {
    expect(presentation(state(), [face]).candidates.map(({ id }) => id)).toEqual(["curved-face"])
    expect(presentation(state(), [{ ...face, meshFaceId: 43 }]).candidates).toEqual([])
    expect(presentation(state(), [{ ...face, outputRole: "left" }]).candidates).toEqual([])
    expect(presentation(state(), [{ ...body, outputRole: "missing" }]).candidates).toEqual([])
  })

  it.each([
    ["missing evaluation", []],
    ["failed evaluation", [{ featureId: "input", status: "failed", diagnostics: [] }]],
    ["hash mismatch", [{ featureId: "input", status: "succeeded", contentHash: "b".repeat(64) }]],
    [
      "duplicate evaluation",
      [
        { featureId: "input", status: "succeeded", contentHash: "a".repeat(64) },
        { featureId: "input", status: "succeeded", contentHash: "a".repeat(64) },
      ],
    ],
  ] as const)("rejects eligible source injection with %s", (_reason, evaluationRecords) => {
    const result = presentation(state({ evaluationRecords }))
    expect(result.candidates).toEqual([])
    expect(result.meshes).toEqual([])
  })

  it.each([
    { valid: false, solidCount: 1, volume: 1 },
    { valid: true, solidCount: 0, volume: 1 },
    { valid: true, solidCount: 2, volume: 1 },
    { valid: true, solidCount: 1, volume: 0 },
  ])("rejects invalid or non-single-solid source bodies %#", (bodyShape) => {
    expect(presentation(state({ bodyShape })).candidates).toEqual([])
  })

  it("requires valid whole-producer geometry for explicit legacy options", () => {
    const legacy: ReferencePickCandidate = { kind: "producer", featureId: "input", id: "legacy" }
    expect(presentation(state(), [legacy]).candidates.map(({ id }) => id)).toEqual(["legacy"])
    expect(
      presentation(state({ producerShape: { valid: false, solidCount: 2, volume: 2 } }), [legacy])
        .candidates,
    ).toEqual([])
    expect(presentation(state({ representation: "triangle-mesh" }), [legacy]).candidates).toEqual(
      [],
    )
    expect(presentation(state({ representation: "triangle-mesh" })).candidates).toEqual([])
  })

  it("cannot inject a hidden feature or any hidden authored-part history body", () => {
    expect(presentation(state(), [body], ["input"]).meshes).toEqual([])
    const original = state()
    const hidden = {
      ...original,
      authoredSnapshot: {
        schemaVersion: 2,
        id: "document",
        revision: 7,
        parts: [
          {
            id: "part",
            visible: false,
            bodyHistory: [
              { featureId: "input", outputRole: "right" },
              { featureId: "later", outputRole: "result" },
            ],
          },
        ],
      },
    } as unknown as DocumentControllerState
    expect(presentation(hidden).candidates).toEqual([])
    expect(presentation(hidden).meshes).toEqual([])
    expect(
      presentation(hidden, [body], [], {
        part: true,
      } as unknown as PartVisibilityOverrides).candidates.map(({ id }) => id),
    ).toEqual(["body"])
  })

  it("requires current rebuild identity and excludes the edited feature and all descendants", () => {
    const original = state()
    const report = original.report
    if (!report) throw new Error("Expected a ready picker report.")
    const stale = {
      ...original,
      report: { ...report, snapshot: { ...report.snapshot, revision: 8 } },
    }
    expect(currentReferenceRebuild(stale)).toBeNull()
    expect(presentation(stale).candidates).toEqual([])
    expect(
      presentation(original, [
        { ...body, featureId: "edit" },
        { ...body, featureId: "descendant" },
      ]).candidates,
    ).toEqual([])
  })
})
