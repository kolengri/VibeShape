import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import {
  commandActorSchema,
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "@vibeshape/domain"
import { threadFeatureType } from "@vibeshape/domain/part-design-thread"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const parameters = {
  targetBody: { schemaVersion: 0, featureId: id(1), outputRole: "pattern.instance.2" },
  kind: "external",
  axis: "Z",
  handedness: "right",
  origin: { x: createLengthQuantity(0), y: createLengthQuantity(0), z: createLengthQuantity(0) },
  nominalDiameter: createLengthQuantity(10),
  pitch: createLengthQuantity(2, "mm", "#pitch"),
  length: createLengthQuantity(6),
  depth: createLengthQuantity(0.8),
  clearance: createLengthQuantity(0.1),
  starts: createScalarQuantity(1),
  phase: createAngleQuantity(0),
  runIn: createLengthQuantity(0),
  runOut: createLengthQuantity(0),
}
const base = {
  draftId: id(10),
  baseRevision: 7,
  commandId: id(11),
  featureId: id(12),
  label: "Custom thread",
  dependencies: [id(1)],
  references: [],
  suppressed: false,
  parameters,
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(50),
})
describe("ordinary modeled Thread draft tools", () => {
  it.each(["create_thread", "update_thread"] as const)(
    "routes %s through the existing owned draft command",
    (tool) => {
      const operation = localOperationSchema.parse({ tool, arguments: base })
      expect(isLocalDraftCommand(operation)).toBe(true)
      if (operation.tool !== "create_thread" && operation.tool !== "update_thread")
        throw new Error("Expected Thread operation.")
      expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
        draftId: base.draftId,
        command: {
          baseRevision: 7,
          commandId: base.commandId,
          actor,
          kind:
            tool === "create_thread" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
          payload: {
            feature: {
              id: base.featureId,
              type: threadFeatureType.type,
              parameters,
              dependencies: base.dependencies,
              references: [],
            },
          },
        },
      })
    },
  )
  it.each([
    { dependencies: [] },
    { dependencies: [id(2)] },
    { parameters: { ...parameters, nominalDiameter: createLengthQuantity(0) } },
    { parameters: { ...parameters, starts: createScalarQuantity(1.5) } },
    { parameters: { ...parameters, starts: createScalarQuantity(5) } },
    { parameters: { ...parameters, pitch: createLengthQuantity(0.1) } },
    { parameters: { ...parameters, phase: createAngleQuantity(361, "deg") } },
    { parameters: { ...parameters, clearance: createLengthQuantity(-1) } },
    { parameters: { ...parameters, runOut: createLengthQuantity(6) } },
    { parameters: { ...parameters, depth: createLengthQuantity(2) } },
    { parameters: { ...parameters, smoothTaper: true } },
  ])("rejects malformed exact-body binding and custom-thread limits %j", (change) => {
    expect(
      localOperationSchema.safeParse({ tool: "create_thread", arguments: { ...base, ...change } })
        .success,
    ).toBe(false)
  })
})
