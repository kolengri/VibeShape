import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createLengthQuantity } from "@vibeshape/domain"
import { pressPullFeatureTypeV2 } from "@vibeshape/domain/part-design-press-pull"
import { thickenFeatureType } from "@vibeshape/domain/part-design-thicken"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const targetBody = { schemaVersion: 0, featureId: id(4), outputRole: "pattern.instance.1" }
const face = {
  schemaVersion: 1,
  featureId: id(4),
  outputRole: "pattern.instance.1",
  kind: "face",
  lineageToken: "side.cylinder",
  signature: {
    kind: "face",
    geometryClass: "CYLINDRE",
    measure: 314,
    centroid: [0, 0, 5],
    bounds: { min: [-5, -5, 0], max: [5, 5, 10] },
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
}
const common = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  dependencies: [id(4)],
  references: [],
  suppressed: false,
}
const thickenArgs = {
  ...common,
  parameters: {
    targetBody,
    faces: [face],
    thickness: createLengthQuantity(2, "mm", "#wall"),
    side: "symmetric",
    operation: "add",
  },
}
const pressPullArgs = {
  ...common,
  parameters: {
    targetBody,
    face,
    sourceContentHash: "a".repeat(64),
    distance: createLengthQuantity(-1, "mm"),
  },
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(5),
})

describe("named Thicken and Press Pull draft commands", () => {
  it.each([
    ["create_thicken", thickenArgs, thickenFeatureType.type],
    ["update_thicken", thickenArgs, thickenFeatureType.type],
    ["create_press_pull", pressPullArgs, pressPullFeatureTypeV2.type],
    ["update_press_pull", pressPullArgs, pressPullFeatureTypeV2.type],
  ] as const)("routes %s through the authoritative draft command path", (tool, args, type) => {
    const operation = localOperationSchema.parse({ tool, arguments: args })
    expect(isLocalDraftCommand(operation)).toBe(true)
    if (operation.tool !== tool) throw new Error("Operation must remain narrowed.")
    expect(createLocalCadCommand(operation, actor, id(6))).toMatchObject({
      draftId: id(1),
      command: {
        baseRevision: 7,
        actor,
        kind: tool.startsWith("create")
          ? "org.vibeshape.feature.add"
          : "org.vibeshape.feature.update",
        payload: { feature: { type, parameters: args.parameters } },
      },
    })
  })

  it("rejects foreign faces, unbounded thickness, unknown modes and mismatched targets", () => {
    const thicken = (parameters: object, extra: object = {}) => ({
      tool: "create_thicken",
      arguments: {
        ...thickenArgs,
        ...extra,
        parameters: { ...thickenArgs.parameters, ...parameters },
      },
    })
    const invalid = [
      thicken({ faces: [{ ...face, outputRole: "result" }] }),
      thicken({ faces: [{ ...face, faceIndex: 3 }] }),
      thicken({ thickness: createLengthQuantity(20_000, "mm") }),
      thicken({ side: "both" }),
      thicken({ operation: "intersect" }),
      thicken({}, { dependencies: [id(9)] }),
      { tool: "create_press_pull", arguments: { ...pressPullArgs, dependencies: [id(9)] } },
      {
        tool: "update_press_pull",
        arguments: {
          ...pressPullArgs,
          parameters: { ...pressPullArgs.parameters, distance: createLengthQuantity(0, "mm") },
        },
      },
    ]
    for (const operation of invalid)
      expect(localOperationSchema.safeParse(operation).success).toBe(false)
  })
})
