import { describe, expect, it } from "bun:test"
import { draftIdSchema, featureIdSchema, generateUuidV7 } from "@vibeshape/domain"
import { createLocalInspectionQuery } from "./local-inspection-query"

const id = featureIdSchema.parse(
  generateUuidV7({
    timestampMs: 1_700_000_000_000,
    randomBytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]),
  }),
)

describe("local body measurement query", () => {
  it("binds the paired document identity and preserves role selection", () => {
    expect(
      createLocalInspectionQuery(
        {
          tool: "model_body_measurements",
          arguments: { revision: 4, featureId: id, outputRole: "result", cursor: null, limit: 20 },
        },
        id,
      ),
    ).toEqual<unknown>({
      kind: "org.vibeshape.model.body-measurements",
      schemaVersion: 1,
      documentId: id,
      revision: 4,
      featureId: id,
      outputRole: "result",
      cursor: null,
      limit: 20,
    })
  })
})

it("keeps draft body targets and the paired document distinct from draft identity", () => {
  expect(
    createLocalInspectionQuery(
      {
        tool: "draft_body_topology",
        arguments: {
          draftId: draftIdSchema.parse(id),
          revision: 7,
          featureId: id,
          outputRole: "result",
          topologyKind: "face",
          cursor: null,
          limit: 10,
        },
      },
      id,
    ),
  ).toEqual<unknown>({
    kind: "org.vibeshape.model.body-topology",
    schemaVersion: 1,
    documentId: id,
    revision: 7,
    featureId: id,
    outputRole: "result",
    topologyKind: "face",
    cursor: null,
    limit: 10,
  })
  expect(
    createLocalInspectionQuery(
      {
        tool: "draft_body_measurements",
        arguments: {
          draftId: draftIdSchema.parse(id),
          revision: 7,
          featureId: id,
          outputRole: "result",
          cursor: null,
          limit: 10,
        },
      },
      id,
    ),
  ).toMatchObject({
    kind: "org.vibeshape.model.body-measurements",
    schemaVersion: 1,
    documentId: id,
    revision: 7,
    featureId: id,
    outputRole: "result",
  })
})
