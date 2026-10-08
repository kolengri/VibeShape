import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createAngleQuantity } from "@vibeshape/domain"
import { revolveFeatureTypeV7 } from "@vibeshape/domain/part-design"
import { booleanFeatureTypeV2 } from "@vibeshape/domain/part-design-subtract"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(9),
})
const targetBody = { schemaVersion: 0, featureId: id(4), outputRole: "pattern.instance.0" }
const common = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  dependencies: [id(4)],
  references: [],
  suppressed: false,
}
const cases = [
  {
    name: "body_subtract",
    type: booleanFeatureTypeV2.type,
    parameters: {
      operation: "subtract",
      targetBody,
      toolBody: { ...targetBody, outputRole: "pattern.instance.1" },
      keepTools: true,
    },
  },
  {
    name: "body_revolve",
    type: revolveFeatureTypeV7.type,
    parameters: {
      operation: "remove",
      targetBody,
      profiles: {
        schemaVersion: 0,
        profiles: [
          {
            schemaVersion: 0,
            sketchId: id(5),
            outerBoundaryEntityIds: [id(6)],
            holeBoundaryEntityIds: [],
          },
        ],
      },
      axis: { kind: "origin-axis", axis: "x" },
      angle: createAngleQuantity(360, "deg"),
    },
  },
] as const
describe("named exact-body draft commands", () => {
  for (const entry of cases) {
    it.each(["create", "update"] as const)(
      `routes %s_${entry.name} through the ordinary owned command`,
      (action) => {
        const operation = localOperationSchema.parse({
          tool: `${action}_${entry.name}`,
          arguments: { ...common, parameters: entry.parameters },
        })
        if (
          operation.tool !== "create_body_revolve" &&
          operation.tool !== "update_body_revolve" &&
          operation.tool !== "create_body_subtract" &&
          operation.tool !== "update_body_subtract"
        )
          throw new Error("Expected exact-body tool.")
        expect(isLocalDraftCommand(operation)).toBe(true)
        expect(createLocalCadCommand(operation, actor, id(8))).toMatchObject({
          draftId: id(1),
          command: {
            actor,
            documentId: id(8),
            baseRevision: 7,
            kind:
              action === "create" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
            payload: {
              feature: {
                id: id(3),
                type: entry.type,
                dependencies: [id(4)],
                parameters: entry.parameters,
              },
            },
          },
        })
      },
    )
    it.each([
      { dependencies: [] },
      { dependencies: [id(4), id(4)] },
      { dependencies: [id(8)] },
      { featureId: id(4) },
      { actor },
      { documentId: id(8) },
      { contentHash: "a".repeat(64) },
    ])(`rejects incorrect owners and caller authority for ${entry.name}: %j`, (changes) => {
      expect(
        localOperationSchema.safeParse({
          tool: `create_${entry.name}`,
          arguments: { ...common, parameters: entry.parameters, ...changes },
        }).success,
      ).toBe(false)
    })
  }
  it("rejects repeated body selectors and keeps legacy names separate", () => {
    const input = { ...common, parameters: { ...cases[0].parameters, toolBody: targetBody } }
    expect(
      localOperationSchema.safeParse({ tool: "create_body_subtract", arguments: input }).success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool: "create_boolean",
        arguments: { ...common, parameters: cases[0].parameters },
      }).success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool: "create_revolve",
        arguments: { ...common, parameters: cases[1].parameters },
      }).success,
    ).toBe(false)
  })
})
