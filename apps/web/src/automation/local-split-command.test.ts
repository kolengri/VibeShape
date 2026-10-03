import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createLengthQuantity } from "@vibeshape/domain"
import { splitFeatureType } from "@vibeshape/domain/part-design-split"
import { describe, expect, it } from "vitest"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const arguments_ = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  label: "Split housing",
  dependencies: [id(4)],
  references: [],
  suppressed: false,
  parameters: {
    targetBody: { schemaVersion: 0, featureId: id(4), outputRole: "body.primary" },
    plane: "XZ",
    offset: createLengthQuantity(-3, "mm", "-3 mm"),
  },
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(5),
})
describe("local Split draft commands", () => {
  it.each(["create_split", "update_split"] as const)(
    "routes %s through the shared revision-bound feature command",
    (tool) => {
      const operation = localOperationSchema.parse({ tool, arguments: arguments_ })
      expect(isLocalDraftCommand(operation)).toBe(true)
      if (operation.tool !== "create_split" && operation.tool !== "update_split")
        throw new Error("Expected Split operation.")
      expect(createLocalCadCommand(operation, actor, id(6))).toMatchObject({
        draftId: id(1),
        command: {
          baseRevision: 7,
          commandId: id(2),
          actor,
          documentId: id(6),
          kind:
            tool === "create_split" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
          payload: {
            feature: {
              id: id(3),
              label: "Split housing",
              type: splitFeatureType.type,
              parameters: arguments_.parameters,
              dependencies: [id(4)],
              references: [],
            },
          },
        },
      })
    },
  )
  it.each([
    { dependencies: [] },
    { dependencies: [id(4), id(5)] },
    { dependencies: [id(5)] },
    { parameters: { ...arguments_.parameters, offset: createLengthQuantity(100001) } },
    { parameters: { ...arguments_.parameters, keepSource: true } },
    { parameters: { ...arguments_.parameters, plane: "custom" } },
  ])("rejects unsupported or ambiguous authoring before dispatch %j", (changes) => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_split",
        arguments: { ...arguments_, ...changes },
      }).success,
    ).toBe(false)
  })
})
