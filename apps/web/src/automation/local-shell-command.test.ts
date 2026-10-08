import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createLengthQuantity } from "@vibeshape/domain"
import { shellFeatureTypeV2 } from "@vibeshape/domain/part-design-shell"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const args = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  dependencies: [id(4)],
  references: [],
  suppressed: false,
  parameters: {
    targetBody: { schemaVersion: 0, featureId: id(4), outputRole: "result" },
    thickness: createLengthQuantity(1),
    direction: "inward",
    sourceContentHash: "a".repeat(64),
    openings: [
      {
        schemaVersion: 1,
        featureId: id(4),
        outputRole: "result",
        kind: "face",
        signature: {
          kind: "face",
          geometryClass: "plane",
          measure: 6,
          centroid: [0, 0, 4],
          bounds: { min: [-1, -1.5, 4], max: [1, 1.5, 4] },
          boundaryCount: 4,
          adjacentGeometryClasses: [],
        },
      },
    ],
  },
}
describe("named Shell draft commands", () => {
  it.each(["create_shell", "update_shell"] as const)(
    "validates and routes %s through authoritative revision-bound commands",
    (tool) => {
      const operation = localOperationSchema.parse({ tool, arguments: args })
      expect(isLocalDraftCommand(operation)).toBe(true)
      if (operation.tool !== tool) throw new Error("Shell operation must remain narrowed.")
      const actor = commandActorSchema.parse({
        type: "mcp",
        clientId: "org.example.client",
        sessionId: id(5),
      })
      expect(createLocalCadCommand(operation, actor, id(6))).toMatchObject({
        draftId: id(1),
        command: {
          baseRevision: 7,
          actor,
          kind:
            tool === "create_shell" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
          payload: { feature: { type: shellFeatureTypeV2.type, parameters: args.parameters } },
        },
      })
    },
  )
  it("rejects mismatched target dependency and transient native indices at the protocol boundary", () => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_shell",
        arguments: { ...args, dependencies: [id(5)] },
      }).success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool: "update_shell",
        arguments: {
          ...args,
          parameters: {
            ...args.parameters,
            openings: [{ ...args.parameters.openings[0], faceIndex: 3 }],
          },
        },
      }).success,
    ).toBe(false)
  })
  it("authors a version 2 closed cavity through the named MCP command", () => {
    const operation = localOperationSchema.parse({
      tool: "create_shell",
      arguments: { ...args, parameters: { ...args.parameters, openings: [] } },
    })
    if (operation.tool !== "create_shell") throw new Error("Expected a Shell draft.")
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.client",
      sessionId: id(5),
    })
    expect(createLocalCadCommand(operation, actor, id(6)).command.payload).toMatchObject({
      feature: { type: { schemaVersion: 2 }, parameters: { openings: [] } },
    })
  })
})
