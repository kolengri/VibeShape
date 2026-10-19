import { resolve } from "node:path"
import type { AutomationHost } from "../../packages/automation-host/src/host"
import { expect, test } from "./fixtures"

const paths = {
  controller: "/src/document/document-controller.ts",
  domain: `/@fs${resolve("packages/domain/src/index.ts")}`,
}

type LifecycleFixture = {
  pending: Promise<{ ok: boolean }>
  background: () => Promise<{ ok: boolean }>
  identity: () => { id: string } | null
}
type ProjectResult = { ok: true } | { ok: false; diagnostic: { message: string } }
type ProjectRuntimePort = {
  createActiveDocumentAutomationSession: () =>
    | {
        ok: true
        host: AutomationHost
        documentId: string
        revision: number
        readIdentity: () => { id: string } | null
        enableAutoApply: (actor: unknown) => boolean
      }
    | { ok: false; diagnostic: { message: string } }
}
type BrowserControllerPort = {
  createBrowserDocumentId: () => string
  createBrowserFeatureId: () => string
  createNewLocalProject: () => Promise<ProjectResult>
  activateLocalProject: (projectId: string | undefined) => Promise<ProjectResult>
  closeProjectRuntime: (projectId: string) => Promise<ProjectResult>
  getProjectRuntime: (projectId: string) => ProjectRuntimePort | undefined
  getDocumentControllerState: () => {
    report: { snapshot: { id: string; features: readonly unknown[] } } | null
  }
}

test("retains project review and background CAD authority across tab changes and reload", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/").catch(async (error: unknown) => {
    const state = await page.evaluate(async (controllerPath) => {
      const app: BrowserControllerPort = await import(controllerPath)
      const current = app.getDocumentControllerState()
      return {
        status: (current as { status?: string }).status,
        report: current.report?.snapshot.id,
      }
    }, paths.controller)
    throw new Error(`Initial project creation failed: ${JSON.stringify(state)}; ${String(error)}`)
  })
  const firstId = await page.evaluate(async (paths) => {
    const app: BrowserControllerPort = await import(paths.controller)
    const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
    const projectId = app.getDocumentControllerState().report?.snapshot.id
    if (!projectId) throw new Error("Expected an open project.")
    const runtime = app.getProjectRuntime(projectId)
    if (!runtime) throw new Error("Expected retained project runtime.")
    const connected = runtime.createActiveDocumentAutomationSession()
    if (!connected.ok) throw new Error(connected.diagnostic.message)
    const session = connected
    const actor = domain.commandActorSchema.parse({
      type: "mcp",
      clientId: "org.vibeshape.project-lifecycle-test",
      sessionId: app.createBrowserDocumentId(),
    })
    async function draft(label: string) {
      const created = await session.host.createDraft(actor, {
        schemaVersion: 1,
        documentId: session.documentId,
        baseRevision: session.revision,
      })
      if (!created.ok) throw new Error(created.diagnostic.message)
      const operation = { schemaVersion: 1 as const, draftId: created.value.draftId }
      const applied = await session.host.applyCommand(actor, {
        ...operation,
        command: {
          schemaVersion: 1,
          kind: "org.vibeshape.feature.add",
          commandId: app.createBrowserDocumentId(),
          documentId: session.documentId,
          baseRevision: session.revision,
          issuedAt: new Date().toISOString(),
          actor,
          payload: {
            feature: {
              schemaVersion: 0,
              id: app.createBrowserFeatureId(),
              label,
              type: domain.boxFeatureType.type,
              parameters: {
                width: domain.createLengthQuantity(10),
                depth: domain.createLengthQuantity(20),
                height: domain.createLengthQuantity(30),
                centered: false,
              },
              dependencies: [],
              references: [],
              suppressed: false,
            },
          },
        },
      })
      if (!applied.ok) throw new Error(applied.diagnostic.message)
      const preview = await session.host.previewDraft(actor, operation)
      if (!preview.ok || preview.value.geometry.status !== "valid")
        throw new Error("The project draft must have valid exact geometry.")
      return operation
    }
    const operation = await draft("Reviewed project A box")
    const fixture: LifecycleFixture = {
      pending: session.host.commitDraft(actor, operation),
      identity: session.readIdentity,
      async background() {
        if (!session.enableAutoApply(actor))
          throw new Error("The test's explicit CAD grant failed.")
        return session.host.commitDraft(actor, await draft("Background project A box"))
      },
    }
    ;(globalThis as unknown as { __projectLifecycle: LifecycleFixture }).__projectLifecycle =
      fixture
    return session.documentId
  }, paths)
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  const secondId = await page.evaluate(async (controllerPath) => {
    const app: BrowserControllerPort = await import(controllerPath)
    const result = await app.createNewLocalProject()
    if (!result.ok) throw new Error(result.diagnostic.message)
    return app.getDocumentControllerState().report?.snapshot.id
  }, paths.controller)
  expect(secondId).toBeTruthy()
  expect(secondId).not.toBe(firstId)
  await expect(review).toHaveCount(0)
  expect(
    await page.evaluate(
      async ({ controllerPath, firstId }) => {
        const app: BrowserControllerPort = await import(controllerPath)
        return app.closeProjectRuntime(firstId)
      },
      { controllerPath: paths.controller, firstId },
    ),
  ).toMatchObject({ ok: false })
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as { __projectLifecycle: LifecycleFixture }
        ).__projectLifecycle.identity()?.id,
    ),
  ).toBe(firstId)
  await page.evaluate(
    async ({ controllerPath, firstId }) => {
      const app: BrowserControllerPort = await import(controllerPath)
      const result = await app.activateLocalProject(firstId)
      if (!result.ok) throw new Error(result.diagnostic.message)
    },
    { controllerPath: paths.controller, firstId },
  )
  await expect(review).toBeVisible()
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { __projectLifecycle: LifecycleFixture }).__projectLifecycle
          .pending,
    ),
  ).toMatchObject({ ok: true })
  await page.evaluate(
    async ({ controllerPath, secondId, firstId }) => {
      const app: BrowserControllerPort = await import(controllerPath)
      const selected = await app.activateLocalProject(secondId)
      if (!selected.ok) throw new Error(selected.diagnostic.message)
      const committed = await (
        globalThis as unknown as { __projectLifecycle: LifecycleFixture }
      ).__projectLifecycle.background()
      if (!committed.ok) throw new Error("The background commit failed.")
      if (app.getDocumentControllerState().report?.snapshot.id !== secondId)
        throw new Error("Background work changed the selected project.")
      if (app.getDocumentControllerState().report?.snapshot.features.length !== 0)
        throw new Error("Background work changed another project's geometry.")
      const closed = await app.closeProjectRuntime(firstId)
      if (!closed.ok || app.getProjectRuntime(firstId))
        throw new Error("Closing an idle background project must release its runtime.")
    },
    { controllerPath: paths.controller, secondId, firstId },
  )
  await expect(
    page.getByRole("treeitem", { name: "Background project A box", exact: true }),
  ).toHaveCount(0)
  await page.goto(`/?project=${firstId}`)
  await expect(
    page.getByRole("treeitem", { name: "Reviewed project A box", exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole("treeitem", { name: "Background project A box", exact: true }),
  ).toBeVisible()
  await page.goto(`/?project=${secondId}`)
  await expect(page.getByRole("treeitem", { name: /project A box/ })).toHaveCount(0)
})
