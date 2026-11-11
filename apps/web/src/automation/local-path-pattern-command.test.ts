import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createLengthQuantity, createScalarQuantity } from "@vibeshape/domain"
import { patternFeatureTypeV2 } from "@vibeshape/domain/part-design-pattern"
import { patternFeatureTypeV3 } from "@vibeshape/domain/part-design-pattern-path"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(9),
})
const targetBody = { schemaVersion: 0 as const, featureId: id(4), outputRole: "result" }
const parameters = {
  targetBody,
  kind: "path",
  count: createScalarQuantity(5),
  path: { schemaVersion: 0, sketchId: id(20), entityIds: [id(21), id(22)], startPointId: id(23) },
  spacing: { mode: "fixed", distance: createLengthQuantity(12) },
  startOffset: createLengthQuantity(0),
  orientation: "follow",
  reverse: false,
}
const common = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  dependencies: [id(4), id(5)],
  references: [],
  suppressed: false,
  label: "Path pattern",
}

function parse(tool: string, changes: Record<string, unknown> = {}) {
  return localOperationSchema.safeParse({
    tool,
    arguments: { ...common, parameters, ...changes },
  })
}

describe("path Pattern MCP authoring", () => {
  it.each(["create", "update"] as const)(
    "routes %s_reference_body_pattern with kind path to Pattern v3",
    (action) => {
      const operation = localOperationSchema.parse({
        tool: `${action}_reference_body_pattern`,
        arguments: { ...common, parameters },
      })
      expect(isLocalDraftCommand(operation)).toBe(true)
      if (
        operation.tool !== "create_reference_body_pattern" &&
        operation.tool !== "update_reference_body_pattern"
      )
        throw new Error("Expected a reference body pattern operation.")
      expect(createLocalCadCommand(operation, actor, id(6))).toMatchObject({
        command: {
          kind: action === "create" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
          payload: {
            feature: {
              type: patternFeatureTypeV3.type,
              parameters,
              dependencies: [id(4), id(5)],
              references: [],
            },
          },
        },
      })
    },
  )

  it("keeps axis patterns on version 2", () => {
    const operation = localOperationSchema.parse({
      tool: "create_reference_body_pattern",
      arguments: {
        ...common,
        dependencies: [id(4)],
        parameters: {
          targetBody,
          kind: "linear",
          axis: { kind: "origin-axis", axis: "X" },
          count: createScalarQuantity(3),
          spacing: createLengthQuantity(10),
        },
      },
    })
    if (operation.tool !== "create_reference_body_pattern")
      throw new Error("Expected a reference body pattern operation.")
    expect(createLocalCadCommand(operation, actor, id(6))).toMatchObject({
      command: { payload: { feature: { type: patternFeatureTypeV2.type } } },
    })
  })

  it.each([
    { dependencies: [id(5), id(4)] },
    { dependencies: [id(4), id(3)] },
    { dependencies: [] },
    { references: [{}] },
    { parameters: { ...parameters, spacing: { mode: "fixed" } } },
    {
      parameters: { ...parameters, spacing: { mode: "fixed", distance: createLengthQuantity(0) } },
    },
    { parameters: { ...parameters, startOffset: createLengthQuantity(-1) } },
    { parameters: { ...parameters, orientation: "frenet" } },
    { parameters: { ...parameters, axis: { kind: "origin-axis", axis: "X" } } },
    { parameters: { ...parameters, path: { ...parameters.path, entityIds: [id(22), id(21)] } } },
    { parameters: { ...parameters, sourceContentHash: "a".repeat(64) } },
    { actor },
  ])("rejects malformed or privileged path pattern input %j", (changes) => {
    expect(parse("create_reference_body_pattern", changes).success).toBe(false)
  })

  it("accepts a target-only path pattern whose sketch has no support owner", () => {
    expect(
      parse("create_reference_body_pattern", {
        dependencies: [id(4)],
        parameters: { ...parameters, spacing: { mode: "equal" } },
      }).success,
    ).toBe(true)
  })
})
