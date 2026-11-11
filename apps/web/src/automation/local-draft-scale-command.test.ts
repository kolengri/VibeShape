import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import {
  commandActorSchema,
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "@vibeshape/domain"
import { draftFeatureType } from "@vibeshape/domain/part-design-draft"
import { scaleFeatureType } from "@vibeshape/domain/part-design-scale"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const targetBody = { schemaVersion: 0, featureId: id(4), outputRole: "pattern.instance.1" }
const face = {
  schemaVersion: 1,
  featureId: id(4),
  outputRole: "pattern.instance.1",
  kind: "face",
  lineageToken: "side.x-max",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 200,
    centroid: [10, 0, 5],
    bounds: { min: [10, -10, 0], max: [10, 10, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: [],
  },
}
const common = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  references: [],
  suppressed: false,
}
const draftArgs = {
  ...common,
  dependencies: [id(4)],
  parameters: {
    targetBody,
    faces: [face],
    neutralPlane: { kind: "origin-plane", plane: "XY" },
    angle: createAngleQuantity(3, "deg", "3 deg"),
    flip: false,
  },
}
const scaleArgs = {
  ...common,
  dependencies: [id(4)],
  parameters: {
    targetBody,
    factor: createScalarQuantity(2, "#ratio"),
    center: {
      kind: "point",
      point: { x: createLengthQuantity(1), y: createLengthQuantity(2), z: createLengthQuantity(3) },
    },
  },
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(5),
})

describe("named Draft and Scale draft commands", () => {
  it.each([
    ["create_face_draft", draftArgs, draftFeatureType.type],
    ["update_face_draft", draftArgs, draftFeatureType.type],
    ["create_scale", scaleArgs, scaleFeatureType.type],
    ["update_scale", scaleArgs, scaleFeatureType.type],
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

  it("binds a Datum Plane neutral plane as the second dependency", () => {
    const parameters = {
      ...draftArgs.parameters,
      neutralPlane: { kind: "datum-plane", featureId: id(8) },
    }
    const valid = { ...draftArgs, dependencies: [id(4), id(8)], parameters }
    expect(
      localOperationSchema.safeParse({ tool: "create_face_draft", arguments: valid }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "create_face_draft",
        arguments: { ...valid, dependencies: [id(4)] },
      }).success,
    ).toBe(false)
  })

  it("rejects foreign faces, native indices, unbounded angles and mismatched targets", () => {
    const invalid = [
      {
        tool: "create_face_draft",
        arguments: {
          ...draftArgs,
          parameters: { ...draftArgs.parameters, faces: [{ ...face, outputRole: "result" }] },
        },
      },
      {
        tool: "create_face_draft",
        arguments: {
          ...draftArgs,
          parameters: { ...draftArgs.parameters, faces: [{ ...face, faceIndex: 3 }] },
        },
      },
      {
        tool: "update_face_draft",
        arguments: {
          ...draftArgs,
          parameters: { ...draftArgs.parameters, angle: createAngleQuantity(89, "deg") },
        },
      },
      { tool: "create_scale", arguments: { ...scaleArgs, dependencies: [id(9)] } },
      {
        tool: "update_scale",
        arguments: {
          ...scaleArgs,
          parameters: { ...scaleArgs.parameters, factor: createScalarQuantity(1001) },
        },
      },
    ]
    for (const operation of invalid)
      expect(localOperationSchema.safeParse(operation).success).toBe(false)
  })
})
