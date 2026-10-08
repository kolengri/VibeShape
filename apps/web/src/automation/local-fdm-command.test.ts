import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createAngleQuantity, createLengthQuantity } from "@vibeshape/domain"
import { fdmFeatureType } from "@vibeshape/domain/part-design-fdm"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const parameters = {
  kind: "teardrop-hole",
  targetBody: { schemaVersion: 0, featureId: id(1), outputRole: "split.negative" },
  axis: "X",
  origin: { x: createLengthQuantity(0), y: createLengthQuantity(0), z: createLengthQuantity(5) },
  diameter: createLengthQuantity(6),
  depth: createLengthQuantity(10),
  roofAngle: createAngleQuantity(45, "deg"),
  flatTop: true,
}
const base = {
  draftId: id(10),
  baseRevision: 7,
  commandId: id(11),
  featureId: id(12),
  label: "Teardrop bore",
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
describe("FDM draft commands", () => {
  it.each(["create_fdm", "update_fdm"] as const)("routes %s with exact role ownership", (tool) => {
    const operation = localOperationSchema.parse({ tool, arguments: base })
    expect(isLocalDraftCommand(operation)).toBe(true)
    if (operation.tool !== "create_fdm" && operation.tool !== "update_fdm")
      throw new Error("Expected FDM operation")
    expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
      draftId: base.draftId,
      command: {
        baseRevision: 7,
        actor,
        kind: tool === "create_fdm" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
        payload: {
          feature: {
            id: base.featureId,
            type: fdmFeatureType.type,
            parameters,
            dependencies: [id(1)],
            references: [],
          },
        },
      },
    })
  })
  it.each([
    { dependencies: [] },
    { dependencies: [id(2)] },
    { dependencies: [id(1), id(1)] },
    { featureId: id(1) },
    { references: [{ schemaVersion: 0, featureId: id(1), outputRole: "result" }] },
    { parameters: { ...parameters, diameter: createLengthQuantity(0) } },
    { parameters: { ...parameters, roofAngle: createLengthQuantity(45) } },
    { parameters: { ...parameters, sourceFaceIndex: 1 } },
  ])("rejects invalid geometry or dependency contracts %j", (change) => {
    expect(
      localOperationSchema.safeParse({ tool: "create_fdm", arguments: { ...base, ...change } })
        .success,
    ).toBe(false)
  })
})
