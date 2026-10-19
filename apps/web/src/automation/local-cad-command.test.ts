import { describe, expect, it } from "bun:test"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain"
import { createAngleQuantity, createLengthQuantity } from "@vibeshape/domain/units"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createLocalCadCommand } from "./local-cad-command"
import { createLocalToolExecutor } from "./local-tool-executor"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const profile = {
  schemaVersion: 0,
  sketchId: id(1),
  outerBoundaryEntityIds: [id(2)],
  holeBoundaryEntityIds: [],
}

function profileFeatureParameters(
  tool: string,
  operation: string,
  multi: boolean,
  version: number,
) {
  const extrusion = tool.includes("extrude")
  return {
    ...(version === 5 && extrusion
      ? { reversed: true, secondDistance: createLengthQuantity(3) }
      : {}),
    ...(multi ? { profiles: { schemaVersion: 0, profiles: [profile] } } : { profile }),
    operation,
    ...(extrusion
      ? { distance: createLengthQuantity(30), symmetric: false }
      : { angle: createAngleQuantity(180, "deg"), axis: { kind: "origin-axis", axis: "y" } }),
  }
}

describe("local CAD commands", () => {
  it.each([
    ["create_extrude", "new", false, 2],
    ["update_extrude", "new", true, 3],
    ["create_extrude", "remove", true, 4],
    ["create_extrude", "new", true, 5],
    ["update_extrude", "add", true, 5],
    ["create_extrude", "remove", true, 5],
    ["create_extrude", "intersect", true, 5],
    ["create_revolve", "new", false, 4],
    ["update_revolve", "new", true, 5],
    ["create_revolve", "intersect", true, 6],
  ] as const)(
    "preserves %s %s profile intent in the registered command",
    async (tool, operation, multi, version) => {
      const actor = commandActorSchema.parse({
        type: "mcp",
        clientId: "org.example.client",
        sessionId: id(3),
      })
      const applyCommand = vi.fn().mockResolvedValue({ ok: true, value: {} })
      const executor = createLocalToolExecutor(
        {
          documentId: id(4),
          revision: 0,
          readInfo: () => null,
          readCad: vi.fn(),
          exportRevisionBound: vi.fn(),
          host: {
            applyCommand,
            createDraft: vi.fn(),
            inspectDraft: vi.fn(),
            previewDraft: vi.fn(),
            commitDraft: vi.fn(),
            discardDraft: vi.fn(),
          },
        },
        actor,
      )
      const parameters = profileFeatureParameters(tool, operation, multi, version)
      await executor.execute(
        localOperationSchema.parse({
          tool,
          arguments: {
            draftId: id(5),
            baseRevision: 7,
            commandId: id(6),
            featureId: id(7),
            dependencies: operation === "new" ? [] : [id(8)],
            references: [],
            suppressed: false,
            parameters,
          },
        }),
      )
      expect(applyCommand).toHaveBeenCalledTimes(1)
      const parsed = parseDocumentCommand(applyCommand.mock.calls[0]?.[1].command)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok || !("feature" in parsed.command.payload))
        throw new Error("Missing feature command")
      expect(parsed.command.actor).toEqual(actor)
      expect(parsed.command.documentId).toBe<unknown>(id(4))
      expect(parsed.command.baseRevision).toBe(7)
      expect(parsed.command.kind).toBe(
        tool.startsWith("update") ? "org.vibeshape.feature.update" : "org.vibeshape.feature.add",
      )
      expect(parsed.command.payload.feature.type.schemaVersion).toBe(version)
      expect(parsed.command.payload.feature.parameters).toEqual(parameters)
      expect(parsed.command.payload.feature.dependencies).toEqual<unknown>(
        operation === "new" ? [] : [id(8)],
      )
    },
  )

  it("routes cross-sketch Extrude through v8 while retaining all stable selectors", () => {
    const parameters = {
      profiles: { schemaVersion: 0, profiles: [profile, { ...profile, sketchId: id(9) }] },
      distance: createLengthQuantity(8),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      targetBody: null,
      startOffset: createLengthQuantity(0),
      draftAngle: createAngleQuantity(0),
      operation: "new",
      endCondition: { kind: "distance" },
    }
    const operation = localOperationSchema.parse({
      tool: "create_extrude",
      arguments: {
        draftId: id(5),
        baseRevision: 7,
        commandId: id(6),
        featureId: id(7),
        dependencies: [],
        references: [],
        suppressed: false,
        parameters,
      },
    })
    if (operation.tool !== "create_extrude") throw new Error("Expected an Extrude operation.")
    const request = createLocalCadCommand(
      operation,
      commandActorSchema.parse({ type: "mcp", clientId: "org.example.client", sessionId: id(3) }),
      id(4),
    )
    const parsed = parseDocumentCommand(request.command)
    if (!parsed.ok || !("feature" in parsed.command.payload))
      throw new Error("Expected a feature command.")
    expect(parsed.command.payload.feature.type.schemaVersion).toBe(8)
    expect(parsed.command.payload.feature.parameters).toEqual<unknown>(parameters)
  })

  it("rejects malformed sketch references and invalid solid parameters at the tool boundary", () => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_sketch",
        arguments: {
          draftId: id(5),
          baseRevision: 0,
          commandId: id(6),
          sketch: {
            schemaVersion: 0,
            id: id(1),
            label: "Invalid",
            plane: "xy",
            constraints: [],
            entities: [
              {
                schemaVersion: 0,
                id: id(2),
                type: "line",
                startPointId: id(8),
                endPointId: id(9),
                construction: false,
              },
            ],
          },
        },
      }).success,
    ).toBe(false)
    const args = {
      draftId: id(5),
      baseRevision: 0,
      commandId: id(6),
      featureId: id(7),
      dependencies: [],
      references: [],
      suppressed: false,
    }
    for (const value of [0, -1, Number.POSITIVE_INFINITY]) {
      expect(
        localOperationSchema.safeParse({
          tool: "create_extrude",
          arguments: {
            ...args,
            parameters: {
              profile,
              distance: { ...createLengthQuantity(1), value },
              symmetric: false,
              operation: "new",
            },
          },
        }).success,
      ).toBe(false)
    }
    expect(
      localOperationSchema.safeParse({
        tool: "create_revolve",
        arguments: {
          ...args,
          parameters: {
            profile,
            angle: createAngleQuantity(361, "deg"),
            axis: { kind: "origin-axis", axis: "y" },
            operation: "new",
          },
        },
      }).success,
    ).toBe(false)
  })

  it.each([
    ["create_hole", false],
    ["update_hole", false],
    ["create_hole", true],
    ["update_hole", true],
  ] as const)("preserves %s body selector mode %s", async (tool, named) => {
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.client",
      sessionId: id(3),
    })
    const applyCommand = vi.fn().mockResolvedValue({ ok: true, value: {} })
    const executor = createLocalToolExecutor(
      {
        documentId: id(4),
        revision: 0,
        readInfo: () => null,
        readCad: vi.fn(),
        exportRevisionBound: vi.fn(),
        host: {
          applyCommand,
          createDraft: vi.fn(),
          inspectDraft: vi.fn(),
          previewDraft: vi.fn(),
          commitDraft: vi.fn(),
          discardDraft: vi.fn(),
        },
      },
      actor,
    )
    await executor.execute(
      localOperationSchema.parse({
        tool,
        arguments: {
          draftId: id(5),
          baseRevision: 7,
          commandId: id(6),
          featureId: id(7),
          dependencies: [id(8), id(9)],
          references: [],
          suppressed: false,
          parameters: {
            ...(named
              ? {
                  targetBody: {
                    schemaVersion: 0,
                    featureId: id(8),
                    outputRole: "pattern.instance.1",
                  },
                }
              : {}),
            sketchId: id(1),
            pointIds: [id(11), id(2)],
            diameter: createLengthQuantity(8),
            direction: "forward",
            extent: "blind",
            depth: createLengthQuantity(12),
          },
        },
      }),
    )
    const parsed = parseDocumentCommand(applyCommand.mock.calls[0]?.[1].command)
    expect(parsed).toMatchObject({
      ok: true,
      command: {
        kind: tool === "create_hole" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
        payload: {
          feature: {
            type: {
              typeId: "org.vibeshape.feature.part-design.hole",
              schemaVersion: named ? 2 : 1,
            },
            parameters: named
              ? {
                  pointIds: [id(2), id(11)],
                  targetBody: {
                    schemaVersion: 0,
                    featureId: id(8),
                    outputRole: "pattern.instance.1",
                  },
                }
              : { sketchId: id(1), pointIds: [id(2), id(11)] },
            dependencies: [id(8), id(9)],
          },
        },
      },
    })
  })
})
