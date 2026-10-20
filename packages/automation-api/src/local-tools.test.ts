import { describe, expect, it } from "bun:test"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { localConnectResponseSchema, localResultRequestSchema } from "./local-session"
import { localOperationSchema, localToolOutputs } from "./local-tools"

const id = "0195b5ac-b250-7a2c-8c33-000000000001"
describe("local automation wire contracts", () => {
  it("exposes only named tools with revision and UUIDv7 preconditions", () => {
    const box = {
      tool: "create_box",
      arguments: {
        draftId: id,
        baseRevision: 2,
        commandId: id,
        featureId: id,
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      },
    }
    expect(localOperationSchema.safeParse(box).success).toBe(true)
    for (const extra of [
      { actor: { type: "system" } },
      { documentId: id },
      { widthMm: -1 },
      { baseRevision: 1.5 },
      { featureId: "a5d39d65-095e-4de7-abf6-0a55e5ed3607" },
    ]) {
      expect(
        localOperationSchema.safeParse({ ...box, arguments: { ...box.arguments, ...extra } })
          .success,
      ).toBe(false)
    }
    expect(
      localOperationSchema.safeParse({ tool: "execute", arguments: { script: "anything" } })
        .success,
    ).toBe(false)
  })
  it("requires the exact operation result schema and bounded diagnostics", () => {
    const result = {
      ok: false,
      diagnostic: {
        code: "stale-revision",
        message: "Read the current revision.",
        retryable: true,
      },
    }
    expect(
      localResultRequestSchema.safeParse({
        protocolVersion: 1,
        requestId: "b07e84fd-549f-49b5-b302-a055c304b5a5",
        tool: "preview_draft",
        result,
      }).success,
    ).toBe(true)
    expect(
      localToolOutputs.preview_draft.safeParse({ ok: true, value: { schemaVersion: 1 } }).success,
    ).toBe(false)
    expect(
      localToolOutputs.create_draft.safeParse({
        ...result,
        diagnostic: { ...result.diagnostic, path: "/private/file" },
      }).success,
    ).toBe(false)
    expect(
      localToolOutputs.create_draft.safeParse({
        ...result,
        diagnostic: { ...result.diagnostic, message: "x".repeat(513) },
      }).success,
    ).toBe(false)
  })

  it("accepts typed create and update Hole operations with explicit target dependencies", () => {
    const common = {
      draftId: id,
      baseRevision: 2,
      commandId: id,
      featureId: id,
      dependencies: [id],
      references: [],
      suppressed: false,
      parameters: {
        sketchId: id,
        pointIds: [id],
        diameter: createLengthQuantity(8),
        direction: "forward" as const,
        extent: "blind" as const,
        depth: createLengthQuantity(12),
      },
    }
    expect(localOperationSchema.safeParse({ tool: "create_hole", arguments: common }).success).toBe(
      true,
    )
    expect(localOperationSchema.safeParse({ tool: "update_hole", arguments: common }).success).toBe(
      true,
    )
    const named = {
      ...common,
      parameters: {
        ...common.parameters,
        targetBody: { schemaVersion: 0, featureId: id, outputRole: "pattern.instance.1" },
      },
    }
    for (const tool of ["create_hole", "update_hole"]) {
      expect(localOperationSchema.parse({ tool, arguments: named })).toMatchObject({
        arguments: { parameters: { targetBody: named.parameters.targetBody } },
      })
      expect(
        localOperationSchema.safeParse({
          tool,
          arguments: {
            ...named,
            parameters: { ...named.parameters, targetBody: null },
          },
        }).success,
      ).toBe(false)
    }
    expect(
      localOperationSchema.safeParse({
        tool: "create_hole",
        arguments: {
          ...common,
          parameters: { ...common.parameters, extent: "through-all", depth: undefined },
        },
      }).success,
    ).toBe(false)
  })
  it("accepts body measurement arguments and requires a feature for output roles", () => {
    const valid = {
      tool: "model_body_measurements",
      arguments: { revision: 3, featureId: id, outputRole: "pattern.instance.0" },
    }
    expect(localOperationSchema.safeParse(valid).success).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "model_body_measurements",
        arguments: { revision: 3, outputRole: "pattern.instance.0" },
      }).success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool: "model_body_measurements",
        arguments: { revision: 3 },
      }).success,
    ).toBe(true)
    expect(
      localToolOutputs.model_body_measurements.safeParse({
        ok: false,
        diagnostic: { code: "body-not-found", message: "Missing.", retryable: false },
      }).success,
    ).toBe(true)
  })
  it("accepts only a bounded MCP actor credential in the pairing response", () => {
    const response = {
      protocolVersion: 1,
      token: "A".repeat(43),
      actor: { type: "mcp", clientId: "org.example.client", sessionId: id },
      expiresAt: Date.now() + 1000,
      client: { name: "CAD client", version: "1" },
    }
    expect(localConnectResponseSchema.safeParse(response).success).toBe(true)
    expect(
      localConnectResponseSchema.safeParse({ ...response, actor: { type: "user", userId: null } })
        .success,
    ).toBe(false)
    expect(localConnectResponseSchema.safeParse({ ...response, token: "secret" }).success).toBe(
      false,
    )
  })
})

it("keeps metadata closed-world and separate from legacy CAD draft commands", async () => {
  const { isLocalDraftCommand } = await import("./local-tools")
  const change = localOperationSchema.parse({
    tool: "change_metadata",
    arguments: {
      baseRevision: 4,
      commandId: id,
      change: { kind: "part.rename", partId: id, name: "Housing" },
    },
  })
  expect(isLocalDraftCommand(change)).toBe(false)
  for (const argumentsValue of [
    { ...change.arguments, actor: { type: "system" } },
    { ...change.arguments, documentId: id },
    { ...change.arguments, change: { kind: "part.rename", partId: id, name: " Housing " } },
    { ...change.arguments, change: { kind: "folder.remove", folderId: id, deleteFeatures: true } },
    { ...change.arguments, change: { kind: "execute", code: "anything" } },
  ])
    expect(
      localOperationSchema.safeParse({ tool: "change_metadata", arguments: argumentsValue })
        .success,
    ).toBe(false)
  expect(
    localOperationSchema.safeParse({ tool: "model_parts", arguments: { revision: 4, limit: 201 } })
      .success,
  ).toBe(false)
  expect(
    localOperationSchema.safeParse({
      tool: "model_folders",
      arguments: { revision: 4, cursor: -1 },
    }).success,
  ).toBe(false)
})

it("accepts versioned Chamfer intent while preserving legacy flat tool arguments", () => {
  const signature = {
    kind: "face",
    geometryClass: "PLANE",
    measure: 20,
    centroid: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [2, 10, 0] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  }
  const parameters = {
    targetBody: { schemaVersion: 0, featureId: id, outputRole: "pattern.instance.1" },
    mode: "distance-angle",
    distance: createLengthQuantity(2, "mm", "#bevel"),
    angle: {
      schemaVersion: 0,
      dimension: "angle",
      value: Math.PI / 6,
      unit: "rad",
      source: { value: 30, unit: "deg", expression: "30 deg" },
    },
    measurement: "tangent",
    flip: true,
    tangentPropagation: true,
    targets: [
      {
        kind: "face",
        face: {
          schemaVersion: 1,
          featureId: id,
          outputRole: "pattern.instance.1",
          kind: "face",
          signature,
        },
      },
    ],
    directionOverrides: [],
  }
  const base = { draftId: id, baseRevision: 0, commandId: id, featureId: id }
  for (const tool of ["create_chamfer", "update_chamfer"]) {
    expect(
      localOperationSchema.safeParse({ tool, arguments: { ...base, parameters } }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({ tool, arguments: { ...base, parameters, distanceMm: 2 } })
        .success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool,
        arguments: { ...base, targetFeatureId: id, distanceMm: 2 },
      }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool,
        arguments: { ...base, parameters: { ...parameters, targets: [] } },
      }).success,
    ).toBe(false)
  }
})
