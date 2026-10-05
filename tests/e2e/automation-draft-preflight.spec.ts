import { resolve } from "node:path"
import type { AutomationHost } from "../../packages/automation-host/src/host"
import { expect, test } from "./fixtures"

type BrowserAutomationFactory = {
  createActiveDocumentAutomationSession: () =>
    | { ok: true; host: AutomationHost; documentId: string; revision: number; dispose: () => void }
    | { ok: false; diagnostic: { message: string } }
  getDocumentControllerState: () => {
    report: { snapshot: { revision: number } } | null
    saveStatus: string
  }
}

test("reports a forward History dependency before geometry or Apply and preserves the saved project", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const result = await page.evaluate(
    async ({ controllerPath, domainPath }) => {
      const controller: BrowserAutomationFactory = await import(controllerPath)
      const domain: typeof import("../../packages/domain/src/index") = await import(domainPath)
      const connection = controller.createActiveDocumentAutomationSession()
      if (!connection.ok) throw new Error(connection.diagnostic.message)
      const { host, documentId, revision } = connection
      const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
      const actor = domain.commandActorSchema.parse({
        type: "mcp",
        clientId: "org.vibeshape.preflight-test",
        sessionId: id(1),
      })
      const created = await host.createDraft(actor, {
        schemaVersion: 1,
        documentId,
        baseRevision: revision,
      })
      if (!created.ok) throw new Error(created.diagnostic.message)
      const request = { schemaVersion: 1, draftId: created.value.draftId }
      const box = (featureId: string) => ({
        schemaVersion: 0 as const,
        id: featureId,
        type: domain.boxFeatureType.type,
        parameters: {
          width: domain.createLengthQuantity(10),
          depth: domain.createLengthQuantity(20),
          height: domain.createLengthQuantity(3),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      })
      const subtraction = {
        schemaVersion: 0 as const,
        id: id(4),
        type: domain.booleanFeatureType.type,
        parameters: { operation: "subtract", keepTools: false },
        dependencies: [id(2), id(3)],
        references: [],
        suppressed: false,
      }
      let draftRevision = revision
      async function apply(
        kind: "org.vibeshape.feature.add" | "org.vibeshape.feature.update",
        feature: ReturnType<typeof box> | typeof subtraction,
        commandId: string,
      ) {
        const applied = await host.applyCommand(actor, {
          ...request,
          command: {
            schemaVersion: 1,
            kind,
            commandId,
            documentId,
            baseRevision: draftRevision,
            issuedAt: "2026-10-05T12:00:00Z",
            actor,
            payload: { feature },
          },
        })
        if (!applied.ok) throw new Error(applied.diagnostic.message)
        draftRevision = applied.value.revision
      }
      try {
        await apply("org.vibeshape.feature.add", box(id(2)), id(10))
        await apply("org.vibeshape.feature.add", box(id(3)), id(11))
        await apply("org.vibeshape.feature.add", subtraction, id(12))
        await apply("org.vibeshape.feature.add", box(id(5)), id(13))
        await apply(
          "org.vibeshape.feature.update",
          { ...subtraction, dependencies: [id(5), id(3)] },
          id(14),
        )
        const preview = await host.previewDraft(actor, request)
        const commit = await host.commitDraft(actor, request)
        const state = controller.getDocumentControllerState()
        return {
          preview,
          commit,
          savedRevision: state.report?.snapshot.revision,
          baseRevision: revision,
          saveStatus: state.saveStatus,
          failedCommandId: id(14),
        }
      } finally {
        await host.discardDraft(actor, request)
        connection.dispose()
      }
    },
    {
      controllerPath: "/src/document/document-controller.ts",
      domainPath: `/@fs${resolve("packages/domain/src/index.ts")}`,
    },
  )
  for (const outcome of [result.preview, result.commit]) {
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("Expected authority preflight failure")
    expect(outcome.diagnostic.code).toBe("draft-commit-preflight-failed")
    expect(outcome.diagnostic.message).toContain(result.failedCommandId)
    expect(outcome.diagnostic.message).toContain("org.vibeshape.feature.update")
    expect(outcome.diagnostic.message).toMatch(/history|forward|precede/i)
  }
  expect(result.savedRevision).toBe(result.baseRevision)
  expect(result.saveStatus).toBe("saved")
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
})
