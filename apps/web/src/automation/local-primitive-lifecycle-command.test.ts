import {
  isLocalLifecycleCommand,
  localOperationSchema,
} from "@vibeshape/automation-api/local-tools"
import { localToolAnnotations } from "@vibeshape/automation-api/tool-metadata"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain"
import {
  applyDocumentCommand,
  type DocumentEvent,
  replayDocumentEvents,
} from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it, vi } from "vitest"
import {
  lifecycleId as id,
  primitiveNames,
  primitiveParameters,
} from "../../../../tests/support/primitive-lifecycle"
import { createLocalLifecycleCommand } from "./local-lifecycle-command"
import { createLocalToolExecutor } from "./local-tool-executor"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(1),
})
const command = { draftId: id(2), baseRevision: 7, commandId: id(3) }
const feature = { ...command, featureId: id(4), suppressed: false, label: "Authored primitive" }
function setup(result = { ok: true, value: {} } as unknown) {
  const applyCommand = vi.fn().mockResolvedValue(result)
  const executor = createLocalToolExecutor(
    {
      documentId: id(5),
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
  return { executor, applyCommand }
}

describe("named primitive and lifecycle authority", () => {
  it("keeps dependency-blocked removal revision-stable and replays exact lifecycle state through ordinary domain events", () => {
    let snapshot: DocumentSnapshot | null = null
    const events: DocumentEvent[] = []
    let sequence = 100
    function apply(kind: string, payload: Record<string, unknown>) {
      const result = applyDocumentCommand(snapshot, {
        kind,
        schemaVersion: 1,
        documentId: id(5),
        commandId: id(sequence++),
        baseRevision: snapshot?.revision ?? 0,
        issuedAt: new Date().toISOString(),
        actor,
        payload,
      })
      if (!result.ok) throw new Error(result.diagnostic.message)
      snapshot = result.snapshot
      events.push(result.event)
    }
    function lifecycle(tool: string, payload: Record<string, unknown>) {
      const operation = localOperationSchema.parse({
        tool,
        arguments: {
          ...command,
          commandId: id(sequence++),
          baseRevision: snapshot?.revision ?? 0,
          ...payload,
        },
      })
      if (!isLocalLifecycleCommand(operation))
        throw new Error("Expected a named lifecycle command.")
      const request = createLocalLifecycleCommand(operation, actor, id(5))
      const result = applyDocumentCommand(snapshot, request.command)
      if (result.ok) {
        snapshot = result.snapshot
        events.push(result.event)
      }
      return result
    }
    apply("org.vibeshape.document.create", { name: "Lifecycle source" })
    apply("org.vibeshape.feature.add", {
      feature: {
        schemaVersion: 0,
        id: id(4),
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.box",
          schemaVersion: 1,
        },
        parameters: primitiveParameters("box"),
        dependencies: [],
        references: [],
        suppressed: false,
      },
    })
    apply("org.vibeshape.feature.add", {
      feature: {
        schemaVersion: 0,
        id: id(8),
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.fillet",
          schemaVersion: 1,
        },
        parameters: { radius: createLengthQuantity(1) },
        dependencies: [id(4)],
        references: [],
        suppressed: false,
      },
    })
    const prior = snapshot
    expect(lifecycle("remove_feature", { featureId: id(4) })).toMatchObject({
      ok: false,
      diagnostic: { code: "feature-in-use" },
    })
    expect(snapshot).toBe(prior)
    expect(lifecycle("set_feature_suppressed", { featureId: id(8), suppressed: true }).ok).toBe(
      true,
    )
    expect(lifecycle("set_feature_suppressed", { featureId: id(8), suppressed: false }).ok).toBe(
      true,
    )
    expect(lifecycle("remove_feature", { featureId: id(8) }).ok).toBe(true)
    expect(lifecycle("remove_feature", { featureId: id(4) }).ok).toBe(true)
    apply("org.vibeshape.sketch.add", {
      sketch: {
        schemaVersion: 0,
        id: id(6),
        label: "Lifecycle sketch",
        plane: "xy",
        entities: [],
        constraints: [],
      },
    })
    expect(lifecycle("remove_sketch", { sketchId: id(6) }).ok).toBe(true)
    expect(lifecycle("rename_project", { name: "Lifecycle result" }).ok).toBe(true)
    expect(replayDocumentEvents(events)).toMatchObject({ ok: true, snapshot })
  })
  it.each(
    primitiveNames.flatMap((name) =>
      (name === "box" ? ["update"] : ["create", "update"]).map((action) => ({ name, action })),
    ),
  )(
    "routes $action $name through the registered typed feature command",
    async ({ name, action }) => {
      const { executor, applyCommand } = setup()
      const parameters = primitiveParameters(name, 1, "#dimension")
      await executor.execute(
        localOperationSchema.parse({
          tool: `${action}_${name}`,
          arguments: { ...feature, parameters },
        }),
      )
      expect(applyCommand).toHaveBeenCalledOnce()
      expect(applyCommand.mock.calls[0]?.[0]).toEqual(actor)
      const request = applyCommand.mock.calls[0]?.[1]
      expect(parseDocumentCommand(request.command).ok).toBe(true)
      expect(request).toMatchObject({
        draftId: command.draftId,
        command: {
          actor,
          documentId: id(5),
          commandId: command.commandId,
          baseRevision: 7,
          kind: `org.vibeshape.feature.${action === "create" ? "add" : "update"}`,
          payload: {
            feature: {
              id: feature.featureId,
              type: { typeId: `org.vibeshape.feature.part-design.${name}`, schemaVersion: 1 },
              parameters,
              dependencies: [],
              references: [],
              suppressed: false,
              label: feature.label,
            },
          },
        },
      })
    },
  )

  it.each([
    ["remove_feature", "org.vibeshape.feature.remove", { featureId: id(4) }],
    ["remove_sketch", "org.vibeshape.sketch.remove", { sketchId: id(6) }],
    [
      "set_feature_suppressed",
      "org.vibeshape.feature.set-suppressed",
      { featureId: id(4), suppressed: false },
    ],
    ["rename_project", "org.vibeshape.document.rename", { name: "Renamed project" }],
  ] as const)("routes %s through the ordinary revisioned command", async (tool, kind, payload) => {
    const { executor, applyCommand } = setup()
    await executor.execute(
      localOperationSchema.parse({ tool, arguments: { ...command, ...payload } }),
    )
    const request = applyCommand.mock.calls[0]?.[1]
    expect(parseDocumentCommand(request.command).ok).toBe(true)
    expect(request).toMatchObject({
      draftId: command.draftId,
      command: { kind, actor, documentId: id(5), baseRevision: 7, payload },
    })
    expect(localToolAnnotations(tool)).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: tool === "remove_feature" || tool === "remove_sketch",
    })
  })

  it.each(["feature-in-use", "sketch-in-use", "revision-conflict", "draft-not-owned"])(
    "preserves the bounded %s failure without requesting commit or escalating authority",
    async (code) => {
      const result = {
        ok: false,
        diagnostic: {
          code,
          message: "Repair the existing dependency.",
          retryable: false,
          issues: [],
        },
      }
      const { executor, applyCommand } = setup(result)
      await expect(
        executor.execute(
          localOperationSchema.parse({
            tool: "remove_feature",
            arguments: { ...command, featureId: id(4) },
          }),
        ),
      ).resolves.toEqual({
        ok: false,
        diagnostic: { code, message: result.diagnostic.message, retryable: false },
      })
      expect(applyCommand).toHaveBeenCalledOnce()
    },
  )
})
