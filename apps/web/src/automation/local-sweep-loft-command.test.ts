import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain"
import { loftFeatureType } from "@vibeshape/domain/part-design-loft"
import { sweepFeatureType } from "@vibeshape/domain/part-design-sweep"
import { describe, expect, it } from "vitest"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const profile = (n: number) => ({
  schemaVersion: 0,
  sketchId: id(n),
  outerBoundaryEntityIds: [id(n + 10)],
  holeBoundaryEntityIds: [],
})
const loft = { sections: [profile(2), profile(1)], ruled: true }
const sweep = {
  profile: profile(1),
  path: { schemaVersion: 0, sketchId: id(3), entityIds: [id(21), id(22)], startPointId: id(30) },
}
const base = {
  draftId: id(40),
  commandId: id(41),
  baseRevision: 7,
  featureId: id(42),
  label: "Path-authored housing",
  dependencies: [],
  references: [],
  suppressed: false,
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(50),
})
describe("ordinary Sweep and Loft draft tools", () => {
  it.each(["create_loft", "update_loft", "create_sweep", "update_sweep"] as const)(
    "routes %s through one validated ordinary command",
    (tool) => {
      const parameters = tool.endsWith("loft") ? loft : sweep
      const operation = localOperationSchema.parse({ tool, arguments: { ...base, parameters } })
      expect(isLocalDraftCommand(operation)).toBe(true)
      if (
        operation.tool !== "create_loft" &&
        operation.tool !== "update_loft" &&
        operation.tool !== "create_sweep" &&
        operation.tool !== "update_sweep"
      )
        throw new Error("Expected typed multi-sketch tool.")
      expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
        draftId: base.draftId,
        command: {
          baseRevision: 7,
          commandId: base.commandId,
          actor,
          kind: tool.startsWith("create_")
            ? "org.vibeshape.feature.add"
            : "org.vibeshape.feature.update",
          payload: {
            feature: {
              id: base.featureId,
              type: tool.endsWith("loft") ? loftFeatureType.type : sweepFeatureType.type,
              parameters,
              dependencies: [],
              references: [],
            },
          },
        },
      })
    },
  )
  it.each([
    { tool: "create_loft", parameters: { ...loft, sections: [profile(1)] } },
    { tool: "create_loft", parameters: { ...loft, sections: [profile(1), profile(1)] } },
    {
      tool: "create_loft",
      parameters: {
        ...loft,
        sections: [{ ...profile(1), holeBoundaryEntityIds: [[id(99)]] }, profile(2)],
      },
    },
    {
      tool: "create_sweep",
      parameters: { ...sweep, path: { ...sweep.path, entityIds: [id(22), id(21)] } },
    },
    {
      tool: "create_sweep",
      parameters: { ...sweep, path: { ...sweep.path, startPointId: undefined } },
    },
    { tool: "create_sweep", parameters: { ...sweep, profileIndex: 0 } },
  ])("rejects unsupported or ambiguous selectors before dispatch %j", ({ tool, parameters }) => {
    expect(
      localOperationSchema.safeParse({ tool, arguments: { ...base, parameters } }).success,
    ).toBe(false)
  })
})
