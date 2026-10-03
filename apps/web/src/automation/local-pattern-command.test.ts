import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import {
  commandActorSchema,
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "@vibeshape/domain"
import { patternFeatureType } from "@vibeshape/domain/part-design-pattern"
import { describe, expect, it } from "vitest"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const base = {
  draftId: id(40),
  commandId: id(41),
  baseRevision: 7,
  featureId: id(42),
  label: "Bracket copies",
  dependencies: [id(1)],
  references: [],
  suppressed: false,
}
const targetBody = { schemaVersion: 0 as const, featureId: id(1), outputRole: "split.positive" }
const linear = {
  targetBody,
  kind: "linear",
  axis: "X",
  count: createScalarQuantity(4, "#instances"),
  spacing: createLengthQuantity(-20),
}
const circular = {
  targetBody,
  kind: "circular",
  axis: "Z",
  count: createScalarQuantity(4),
  angle: createAngleQuantity(-360, "deg"),
  center: { x: createLengthQuantity(0), y: createLengthQuantity(0), z: createLengthQuantity(0) },
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(50),
})

describe("ordinary body Pattern draft tools", () => {
  it.each(["create_body_pattern", "update_body_pattern"] as const)(
    "routes %s through one validated ordinary exact-body command",
    (tool) => {
      for (const parameters of [linear, circular]) {
        const operation = localOperationSchema.parse({ tool, arguments: { ...base, parameters } })
        expect(isLocalDraftCommand(operation)).toBe(true)
        if (operation.tool !== "create_body_pattern" && operation.tool !== "update_body_pattern")
          throw new Error("Expected body Pattern operation.")
        expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
          draftId: base.draftId,
          command: {
            baseRevision: 7,
            commandId: base.commandId,
            actor,
            kind:
              tool === "create_body_pattern"
                ? "org.vibeshape.feature.add"
                : "org.vibeshape.feature.update",
            payload: {
              feature: {
                id: base.featureId,
                type: patternFeatureType.type,
                parameters,
                dependencies: base.dependencies,
                references: [],
              },
            },
          },
        })
      }
    },
  )
  it.each([
    { ...base, dependencies: [] },
    { ...base, dependencies: [id(2)] },
    { ...base, parameters: { ...linear, count: createScalarQuantity(1) } },
    { ...base, parameters: { ...linear, count: createScalarQuantity(2.5) } },
    { ...base, parameters: { ...linear, count: createScalarQuantity(257) } },
    { ...base, parameters: { ...linear, spacing: createLengthQuantity(0) } },
    { ...base, parameters: { ...linear, spacing: createLengthQuantity(50_000) } },
    { ...base, parameters: { ...circular, angle: createAngleQuantity(361, "deg") } },
    { ...base, parameters: { ...linear, fuseInstances: true } },
  ])("rejects malformed or unauthorized authored shape %j", (input) => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_body_pattern",
        arguments: { ...base, parameters: linear, ...input },
      }).success,
    ).toBe(false)
  })
})
