import { localModelInfoSchema, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { documentSummaryViewSchema } from "@vibeshape/automation-api/queries"
import {
  commandActorSchema,
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  generateUuidV7,
  parseDocumentCommand,
} from "@vibeshape/domain"
import { describe, expect, it, vi } from "vitest"
import { createLocalToolExecutor } from "./local-tool-executor"

const id = (offset = 0) =>
  generateUuidV7({
    timestampMs: 1_700_000_000_000 + offset,
    randomBytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, offset]),
  })

const edgeReference = (featureId: ReturnType<typeof featureIdSchema.parse>, role: string) => ({
  schemaVersion: 0 as const,
  featureId,
  kind: "edge" as const,
  semanticRole: role,
  signature: {
    kind: "edge" as const,
    geometryClass: "LINE",
    measure: 10,
    centroid: [5, 0, 0] as [number, number, number],
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [10, 0, 0] as [number, number, number],
    },
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
})

describe("local automation tool executor", () => {
  it("forwards named body measurement reads through the committed CAD port", async () => {
    const host = {
      createDraft: vi.fn(),
      inspectDraft: vi.fn(),
      applyCommand: vi.fn(),
      previewDraft: vi.fn(),
      commitDraft: vi.fn(),
      discardDraft: vi.fn(),
    }
    const readCad = vi.fn().mockReturnValue({
      ok: false,
      diagnostic: {
        code: "body-not-found",
        message: "Missing body.",
        retryable: false,
        issues: [],
      },
    })
    const executor = createLocalToolExecutor(
      {
        documentId: id(2),
        revision: 0,
        host,
        readCad,
        readInfo: () => null,
        exportRevisionBound: vi.fn(),
      },
      commandActorSchema.parse({ type: "mcp", clientId: "org.example.client", sessionId: id(1) }),
    )
    const operation = localOperationSchema.parse({
      tool: "model_body_measurements",
      arguments: { revision: 7, featureId: id(3), outputRole: "result" },
    })
    await expect(executor.execute(operation)).resolves.toEqual({
      ok: false,
      diagnostic: { code: "body-not-found", message: "Missing body.", retryable: false },
    })
    expect(readCad).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "org.vibeshape.model.body-measurements",
        documentId: id(2),
        featureId: id(3),
        outputRole: "result",
      }),
    )
  })

  it.each([
    ["draft_tree", "org.vibeshape.cad.inspection.list", {}],
    [
      "draft_entity",
      "org.vibeshape.cad.inspection.detail",
      { entity: { kind: "feature", id: id(8) } },
    ],
    ["draft_variables", "org.vibeshape.variable.list", {}],
    ["draft_edges", "org.vibeshape.model.edges", { featureId: id(8) }],
    [
      "draft_body_measurements",
      "org.vibeshape.model.body-measurements",
      { featureId: id(8), outputRole: "result" },
    ],
    [
      "draft_body_topology",
      "org.vibeshape.model.body-topology",
      { featureId: id(8), outputRole: "result", topologyKind: "face" },
    ],
  ])("routes %s to the owned draft host with the paired document", async (tool, kind, extra) => {
    const failure = {
      ok: false,
      diagnostic: {
        code: "draft-expired",
        message: "Draft expired.",
        retryable: false,
        issues: [],
      },
    }
    const host = {
      createDraft: vi.fn(),
      inspectDraft: vi.fn().mockResolvedValue(failure),
      applyCommand: vi.fn(),
      previewDraft: vi.fn(),
      commitDraft: vi.fn(),
      discardDraft: vi.fn(),
    }
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.client",
      sessionId: id(1),
    })
    const readCad = vi.fn()
    const executor = createLocalToolExecutor(
      {
        documentId: id(2),
        revision: 0,
        host,
        readCad,
        readInfo: () => null,
        exportRevisionBound: vi.fn(),
      },
      actor,
    )
    const operation = localOperationSchema.parse({
      tool,
      arguments: { ...extra, draftId: id(3), revision: 7 },
    })
    await expect(executor.execute(operation)).resolves.toEqual({
      ok: false,
      diagnostic: { code: "draft-expired", message: "Draft expired.", retryable: false },
    })
    expect(host.inspectDraft).toHaveBeenCalledWith(actor, {
      schemaVersion: 1,
      draftId: id(3),
      query: expect.objectContaining({ kind, schemaVersion: 1, documentId: id(2), revision: 7 }),
    })
    expect(host.inspectDraft.mock.calls[0]?.[1].query).not.toHaveProperty("draftId")
    expect(readCad).not.toHaveBeenCalled()
    expect(host.applyCommand).not.toHaveBeenCalled()
  })

  it("routes model info through the captured document port", async () => {
    const host = {
      createDraft: vi.fn(),
      inspectDraft: vi.fn(),
      applyCommand: vi.fn(),
      previewDraft: vi.fn(),
      commitDraft: vi.fn(),
      discardDraft: vi.fn(),
    }
    const info = {
      summary: documentSummaryViewSchema.parse({
        kind: "org.vibeshape.document.summary",
        schemaVersion: 1,
        documentId: id(),
        revision: 0,
        classification: "semantic",
        truncated: false,
        data: {
          name: "Box",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      measurements: null,
      measurementDiagnostic: null,
    }
    const executor = createLocalToolExecutor(
      {
        documentId: info.summary.documentId,
        revision: 0,
        host,
        readCad: vi.fn(),
        readInfo: () => info,
        exportRevisionBound: vi.fn(),
      },
      commandActorSchema.parse({ type: "mcp", clientId: "org.example.client", sessionId: id(1) }),
    )
    await expect(executor.execute({ tool: "model_info", arguments: {} })).resolves.toEqual({
      ok: true,
      value: info,
    })
    expect(host.createDraft).not.toHaveBeenCalled()
  })

  it("turns a box request into one reviewed draft command", async () => {
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.client",
      sessionId: id(2),
    })
    const host = {
      createDraft: vi.fn(),
      inspectDraft: vi.fn(),
      applyCommand: vi.fn().mockResolvedValue({ ok: true, value: { draftId: id(3) } }),
      previewDraft: vi.fn(),
      commitDraft: vi.fn(),
      discardDraft: vi.fn(),
    }
    const documentId = id(4)
    const draftId = id(5)
    const executor = createLocalToolExecutor(
      {
        documentId,
        revision: 0,
        host,
        readCad: vi.fn(),
        readInfo: () => null,
        exportRevisionBound: vi.fn(),
      },
      actor,
    )
    await executor.execute({
      tool: "create_box",
      arguments: {
        draftId: draftIdSchema.parse(draftId),
        baseRevision: 0,
        commandId: commandIdSchema.parse(id(6)),
        featureId: featureIdSchema.parse(id(7)),
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      },
    })
    expect(host.applyCommand).toHaveBeenCalledOnce()
    const command = host.applyCommand.mock.calls[0]?.[1].command
    const parsed = parseDocumentCommand(command)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && "feature" in parsed.command.payload) {
      expect(parsed.command.kind).toBe("org.vibeshape.feature.add")
      expect(parsed.command.payload.feature.type.typeId).toBe(
        "org.vibeshape.feature.part-design.box",
      )
      expect(parsed.command.payload.feature.parameters.width).toMatchObject({
        value: 10,
        unit: "mm",
      })
    }
  })

  it("fails closed for cancellation and export failures", async () => {
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.client",
      sessionId: id(8),
    })
    const controller = new AbortController()
    controller.abort()
    const executor = createLocalToolExecutor(
      {
        documentId: id(9),
        revision: 0,
        host: {
          createDraft: vi.fn(),
          inspectDraft: vi.fn(),
          applyCommand: vi.fn(),
          previewDraft: vi.fn(),
          commitDraft: vi.fn(),
          discardDraft: vi.fn(),
        },
        readCad: vi.fn(),
        readInfo: () => null,
        exportRevisionBound: vi.fn().mockResolvedValue({
          ok: false,
          diagnostic: { code: "export-failed", message: "No geometry", retryable: true },
        }),
      },
      actor,
    )
    await expect(
      executor.execute({ tool: "model_info", arguments: {} }, controller.signal),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "request-cancelled" } })
    await expect(
      executor.execute({ tool: "export_model", arguments: { revision: 0, format: "step" } }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "export-failed" } })
  })

  it.each([
    ["create_fillet", "org.vibeshape.feature.add", "fillet", "radius", "#rounding"],
    ["update_fillet", "org.vibeshape.feature.update", "fillet", "radius", "#rounding"],
    ["create_chamfer", "org.vibeshape.feature.add", "chamfer", "distance", "#bevel"],
    ["update_chamfer", "org.vibeshape.feature.update", "chamfer", "distance", "#bevel"],
  ] as const)(
    "preserves %s type, intent, and expression",
    async (tool, kind, featureType, parameter, expression) => {
      const actor = commandActorSchema.parse({
        type: "mcp",
        clientId: "org.example.client",
        sessionId: id(10),
      })
      const host = {
        createDraft: vi.fn(),
        inspectDraft: vi.fn(),
        applyCommand: vi.fn().mockResolvedValue({ ok: true, value: {} }),
        previewDraft: vi.fn(),
        commitDraft: vi.fn(),
        discardDraft: vi.fn(),
      }
      const documentId = id(11)
      const targetFeatureId = featureIdSchema.parse(id(12))
      const executor = createLocalToolExecutor(
        {
          documentId,
          revision: 0,
          host,
          readCad: vi.fn(),
          readInfo: () => null,
          exportRevisionBound: vi.fn(),
        },
        actor,
      )
      await executor.execute(
        localOperationSchema.parse({
          tool,
          arguments: {
            draftId: draftIdSchema.parse(id(13)),
            baseRevision: 0,
            commandId: commandIdSchema.parse(id(15)),
            featureId: featureIdSchema.parse(id(17)),
            targetFeatureId,
            ...(tool === "create_fillet" || tool === "update_fillet"
              ? { radiusMm: 2, radiusExpression: "#rounding" }
              : { distanceMm: 2, distanceExpression: "#bevel" }),
          },
        }),
      )
      const command = host.applyCommand.mock.calls.at(-1)?.[1].command
      const parsed = parseDocumentCommand(command)
      expect(parsed.ok && parsed.command.kind).toBe(kind)
      if (parsed.ok && "feature" in parsed.command.payload) {
        const feature = parsed.command.payload.feature
        expect(feature.type.typeId).toBe(`org.vibeshape.feature.part-design.${featureType}`)
        expect(feature.type.schemaVersion).toBe(1)
        expect(feature.dependencies).toEqual([targetFeatureId])
        expect(feature.references).toEqual([])
        expect(feature.parameters[parameter]).toMatchObject({
          value: 2,
          unit: "mm",
          source: { expression: expression },
        })
      }
    },
  )

  it.each([
    ["create_fillet", "org.vibeshape.feature.add", "fillet", "radius", "#rounding"],
    ["update_chamfer", "org.vibeshape.feature.update", "chamfer", "distance", "#bevel"],
  ] as const)(
    "preserves selected references for %s",
    async (tool, kind, featureType, parameter, expression) => {
      const actor = commandActorSchema.parse({
        type: "mcp",
        clientId: "org.example.client",
        sessionId: id(20),
      })
      const host = {
        createDraft: vi.fn(),
        inspectDraft: vi.fn(),
        applyCommand: vi.fn().mockResolvedValue({ ok: true, value: {} }),
        previewDraft: vi.fn(),
        commitDraft: vi.fn(),
        discardDraft: vi.fn(),
      }
      const targetFeatureId = featureIdSchema.parse(id(21))
      const edges = [
        edgeReference(targetFeatureId, "edge:one"),
        edgeReference(targetFeatureId, "edge:two"),
      ]
      const executor = createLocalToolExecutor(
        {
          documentId: id(22),
          revision: 0,
          host,
          readCad: vi.fn(),
          readInfo: () => null,
          exportRevisionBound: vi.fn(),
        },
        actor,
      )

      await executor.execute(
        localOperationSchema.parse({
          tool,
          arguments: {
            draftId: draftIdSchema.parse(id(23)),
            baseRevision: 0,
            commandId: commandIdSchema.parse(id(24)),
            featureId: featureIdSchema.parse(id(25)),
            targetFeatureId,
            label: "Selected treatment",
            edges,
            ...(tool === "create_fillet"
              ? { radiusMm: 2, radiusExpression: expression }
              : { distanceMm: 2, distanceExpression: expression }),
          },
        }),
      )

      const parsed = parseDocumentCommand(host.applyCommand.mock.calls.at(-1)?.[1].command)
      expect(parsed.ok).toBe(true)
      if (parsed.ok && "feature" in parsed.command.payload) {
        const feature = parsed.command.payload.feature
        expect(parsed.command.kind).toBe(kind)
        expect(feature.type.typeId).toBe(`org.vibeshape.feature.part-design.${featureType}`)
        expect(feature.type.schemaVersion).toBe(2)
        expect(feature.dependencies).toEqual([targetFeatureId])
        expect(feature.references).toEqual(edges)
        expect(feature.label).toBe("Selected treatment")
        expect(feature.parameters[parameter]).toMatchObject({
          value: 2,
          unit: "mm",
          source: { expression },
        })
      }
    },
  )
})

it("routes metadata to its typed paired port and forwards request cancellation", async () => {
  const actor = commandActorSchema.parse({
    type: "mcp",
    clientId: "org.example.client",
    sessionId: id(1),
  })
  const host = {
    createDraft: vi.fn(),
    inspectDraft: vi.fn(),
    applyCommand: vi.fn(),
    previewDraft: vi.fn(),
    commitDraft: vi.fn(),
    discardDraft: vi.fn(),
  }
  const metadata = {
    read: vi.fn().mockResolvedValue({ ok: true }),
    change: vi.fn().mockResolvedValue({ ok: true }),
    cancel: vi.fn(),
    dispose: vi.fn(),
  }
  const executor = createLocalToolExecutor(
    {
      documentId: id(2),
      revision: 4,
      host,
      metadata,
      readCad: vi.fn(),
      readInfo: () => null,
      exportRevisionBound: vi.fn(),
    },
    actor,
  )
  const listing = localOperationSchema.parse({ tool: "model_parts", arguments: { revision: 4 } })
  await executor.execute(listing)
  expect(metadata.read).toHaveBeenCalledWith("parts", listing.arguments)
  const operation = localOperationSchema.parse({
    tool: "change_metadata",
    arguments: {
      baseRevision: 4,
      commandId: id(3),
      change: { kind: "part.rename", partId: id(4), name: "Housing" },
    },
  })
  const controller = new AbortController()
  await executor.execute(operation, controller.signal)
  expect(metadata.change).toHaveBeenCalledWith(actor, operation.arguments, controller.signal)
  expect(host.applyCommand).not.toHaveBeenCalled()
  controller.abort()
  await expect(executor.execute(operation, controller.signal)).resolves.toMatchObject({
    ok: false,
    diagnostic: { code: "request-cancelled" },
  })
  expect(metadata.change).toHaveBeenCalledTimes(1)
})

it("counts complete model info bytes before returning a diagnostic catalog", async () => {
  const info = localModelInfoSchema.parse({
    summary: {
      kind: "org.vibeshape.document.summary",
      schemaVersion: 1,
      documentId: id(),
      revision: 0,
      classification: "semantic",
      truncated: false,
      data: {
        name: "Model",
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
      },
    },
    measurements: null,
    measurementDiagnostic: {
      code: "geometry-unavailable",
      message: "x".repeat(512),
      retryable: true,
    },
    diagnostics: {
      schemaVersion: 1,
      documentId: id(),
      revision: 0,
      generation: 1,
      status: "invalid",
      truncated: false,
      entries: [
        {
          entity: { kind: "feature", id: id(3) },
          code: "org.vibeshape.feature.geometry-evaluation-failed",
          values: { reason: "x".repeat(130000) },
          action: "inspect-feature",
        },
      ],
    },
  })
  expect(new TextEncoder().encode(JSON.stringify(info.diagnostics)).byteLength).toBeLessThan(131072)
  expect(new TextEncoder().encode(JSON.stringify(info)).byteLength).toBeGreaterThan(131072)
  const host = {
    createDraft: vi.fn(),
    inspectDraft: vi.fn(),
    applyCommand: vi.fn(),
    previewDraft: vi.fn(),
    commitDraft: vi.fn(),
    discardDraft: vi.fn(),
  }
  const executor = createLocalToolExecutor(
    {
      documentId: id(),
      revision: 0,
      host,
      readInfo: () => ({ ...info, diagnostics: info.diagnostics ?? null }),
      readCad: vi.fn(),
      exportRevisionBound: vi.fn(),
    },
    commandActorSchema.parse({ type: "mcp", clientId: "org.example.client", sessionId: id(1) }),
  )
  expect(
    await executor.execute(localOperationSchema.parse({ tool: "model_info", arguments: {} })),
  ).toMatchObject({ ok: false, diagnostic: { code: "query-result-too-large" } })
})
