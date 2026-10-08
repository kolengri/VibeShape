import { describe, expect, it } from "bun:test"
import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import {
  commandActorSchema,
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "@vibeshape/domain"
import { mirrorFeatureTypeV3 } from "@vibeshape/domain/part-design-mirror"
import { patternFeatureTypeV2 } from "@vibeshape/domain/part-design-pattern"
import { splitFeatureTypeV2 } from "@vibeshape/domain/part-design-split"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createLocalCadCommand } from "./local-cad-command"
import { createLocalToolExecutor } from "./local-tool-executor"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(9),
})
const targetBody = { schemaVersion: 0 as const, featureId: id(4), outputRole: "split.positive" }
const common = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  dependencies: [id(4), id(5)],
  references: [],
  suppressed: false,
  label: "Referenced operation",
}
const cases = [
  {
    name: "reference_mirror",
    type: mirrorFeatureTypeV3.type,
    parameters: {
      targetBody,
      plane: { kind: "datum-plane", featureId: id(5) },
      offset: createLengthQuantity(-1, "in"),
      preserveSource: true,
    },
  },
  {
    name: "reference_split",
    type: splitFeatureTypeV2.type,
    parameters: {
      targetBody,
      plane: { kind: "datum-plane", featureId: id(5) },
      offset: createLengthQuantity(2, "mm"),
    },
  },
  {
    name: "reference_body_pattern",
    type: patternFeatureTypeV2.type,
    parameters: {
      targetBody,
      kind: "circular",
      axis: { kind: "datum-axis", featureId: id(5), axis: "normal" },
      count: createScalarQuantity(3, "3"),
      angle: createAngleQuantity(180, "deg"),
    },
  },
] as const
function operationFor(entry: (typeof cases)[number], action: "create" | "update") {
  const operation = localOperationSchema.parse({
    tool: `${action}_${entry.name}`,
    arguments: { ...common, parameters: entry.parameters },
  })
  switch (operation.tool) {
    case "create_reference_mirror":
    case "update_reference_mirror":
    case "create_reference_split":
    case "update_reference_split":
    case "create_reference_body_pattern":
    case "update_reference_body_pattern":
      return operation
    default:
      throw new Error("Expected reference-frame operation.")
  }
}

describe("named reference-frame draft commands", () => {
  for (const entry of cases) {
    it.each(["create", "update"] as const)(
      `routes %s_${entry.name} through owned revision-bound authority`,
      async (action) => {
        const operation = operationFor(entry, action)
        expect(isLocalDraftCommand(operation)).toBe(true)
        expect(createLocalCadCommand(operation, actor, id(6))).toMatchObject({
          draftId: id(1),
          command: {
            actor,
            documentId: id(6),
            commandId: id(2),
            baseRevision: 7,
            kind:
              action === "create" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
            payload: {
              feature: {
                id: id(3),
                type: entry.type,
                parameters: entry.parameters,
                dependencies: [id(4), id(5)],
                references: [],
              },
            },
          },
        })
        const failure = {
          ok: false as const,
          diagnostic: { code: "draft-not-found", message: "Missing owned draft.", issues: [] },
        }
        const host = {
          createDraft: vi.fn(),
          inspectDraft: vi.fn(),
          applyCommand: vi.fn().mockResolvedValue(failure),
          previewDraft: vi.fn(),
          commitDraft: vi.fn(),
          discardDraft: vi.fn(),
        }
        const executor = createLocalToolExecutor(
          {
            documentId: id(6),
            revision: 7,
            host,
            readCad: vi.fn(),
            readInfo: () => null,
            exportRevisionBound: vi.fn(),
          },
          actor,
        )
        expect(await executor.execute(operation)).toMatchObject({
          ok: false,
          diagnostic: { code: "draft-not-found" },
        })
        expect(host.applyCommand).toHaveBeenCalledTimes(1)
        expect(host.applyCommand).toHaveBeenCalledWith(
          actor,
          expect.objectContaining({
            draftId: id(1),
            command: expect.objectContaining({
              actor,
              documentId: id(6),
              payload: { feature: expect.objectContaining({ type: entry.type }) },
            }),
          }),
        )
      },
    )
    it.each([
      { dependencies: [id(5), id(4)] },
      { dependencies: [id(4)] },
      { dependencies: [id(4), id(5), id(5)] },
      { dependencies: [id(4), id(8)] },
      { featureId: id(5) },
      { references: [{}] },
      { actor },
      { documentId: id(6) },
      { sourceContentHash: "a".repeat(64) },
    ])(`rejects ambiguous input and caller authority for ${entry.name}: %j`, (changes) => {
      expect(
        localOperationSchema.safeParse({
          tool: `create_${entry.name}`,
          arguments: { ...common, parameters: entry.parameters, ...changes },
        }).success,
      ).toBe(false)
    })
  }
  it("deduplicates support on the same producer while retaining the exact output role", () => {
    const parameters = { ...cases[1].parameters, plane: { kind: "datum-plane", featureId: id(4) } }
    expect(
      localOperationSchema.safeParse({
        tool: "create_reference_split",
        arguments: { ...common, dependencies: [id(4)], parameters },
      }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "create_reference_split",
        arguments: { ...common, dependencies: [id(4), id(4)], parameters },
      }).success,
    ).toBe(false)
  })
  it("accepts canonical explicit frames and rejects privileged or malformed parameter fields", () => {
    const parameters = {
      ...cases[0].parameters,
      plane: { kind: "explicit-plane", origin: [1, 2, 3], normal: [0, 0, 1] },
    }
    const args = { ...common, dependencies: [id(4)], parameters }
    expect(
      localOperationSchema.safeParse({ tool: "create_reference_mirror", arguments: args }).success,
    ).toBe(true)
    for (const changes of [
      { normal: [0, 0, 0] },
      { origin: [100001, 0, 0] },
      { sourceContentHash: "a".repeat(64) },
      { faceIndex: 0 },
    ])
      expect(
        localOperationSchema.safeParse({
          tool: "create_reference_mirror",
          arguments: {
            ...args,
            parameters: { ...parameters, plane: { ...parameters.plane, ...changes } },
          },
        }).success,
      ).toBe(false)
    expect(localOperationSchema.safeParse({ tool: "create_mirror", arguments: args }).success).toBe(
      false,
    )
    expect(
      localOperationSchema.safeParse({
        tool: "create_body_pattern",
        arguments: { ...common, parameters: cases[2].parameters },
      }).success,
    ).toBe(false)
  })
})
