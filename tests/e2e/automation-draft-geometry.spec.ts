import { resolve } from "node:path"
import { expect, test } from "./fixtures"

const source = (path: string) => `/@fs${resolve(path)}`

test("previews and repairs an automation draft through disposable real document workers", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  const result = await page.evaluate(
    async (paths) => {
      const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
      const drafts: typeof import("../../packages/domain/src/drafts") = await import(paths.drafts)
      const application: typeof import("../../packages/application/src/disposable-document-preview") =
        await import(paths.application)
      const worker: {
        createDocumentWorkerSession: (
          documentId: string,
        ) => import("../../packages/document-worker/src/session-core").DocumentWorkerSession
      } = await import(paths.worker)
      const hostModule: typeof import("../../packages/automation-host/src/host") = await import(
        paths.host
      )
      const queries: typeof import("../../packages/automation-api/src/queries") = await import(
        paths.queries
      )
      const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
      const quantity = domain.createLengthQuantity
      const box = domain.featureRecordSchema.parse({
        schemaVersion: 0,
        id: id(2),
        type: domain.boxFeatureType.type,
        parameters: {
          width: quantity(10),
          depth: quantity(20),
          height: quantity(30),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
        label: "Draft box",
      })
      let current: import("../../packages/domain/src/document").DocumentSnapshot =
        domain.documentSnapshotSchema.parse({
          schemaVersion: 0,
          id: id(1),
          revision: 1,
          name: "Automation worker evidence",
          createdAt: "2026-09-07T00:00:00Z",
          updatedAt: "2026-09-07T00:00:00Z",
          features: [box],
        })
      const modules = domain.createModuleRegistry([
        domain.documentCoreModule,
        domain.featureCoreModule,
        domain.partDesignModule,
      ])
      if (!modules.ok) throw new Error(modules.diagnostic.message)
      const features = domain.createFeatureTypeRegistry(
        modules.registry,
        domain.partDesignFeatureTypeHandlers,
      )
      if (!features.ok) throw new Error(features.diagnostic.message)
      const commands = domain.createCommandDispatcher(
        modules.registry,
        domain.createCoreCommandHandlers(features.registry),
      )
      const query = queries.createQueryDispatcher(
        modules.registry,
        queries.documentCoreQueryHandlers,
      )
      if (!commands.ok || !query.ok) throw new Error("Fixture dispatchers could not be composed.")
      let createdWorkers = 0
      let terminatedWorkers = 0
      const preview = application.createDisposableDocumentPreview({
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        createRebuildPort(documentId) {
          createdWorkers += 1
          const port = worker.createDocumentWorkerSession(documentId)
          return {
            rebuild: (input) => port.rebuild(input),
            exportDocument: (format) => port.exportDocument(format),
            solveSketch: (input) => port.solveSketch(input),
            dispose: (revision) => port.dispose(revision),
            terminate() {
              terminatedWorkers += 1
              port.terminate()
            },
          }
        },
      })
      let commits = 0
      const factory = hostModule.createAutomationHost({
        commandDispatcher: commands.dispatcher,
        queryDispatcher: query.dispatcher,
        createDraftId: () => id(3),
        geometry: {
          async evaluate(snapshot) {
            const result = await preview.preview(snapshot)
            if (!result.ok) throw new Error(result.code)
            return result.evidence
          },
        },
        review: { confirm: () => "approved" },
        documents: {
          readSnapshot: () => current,
          compareAndCommitDraft(draft) {
            const commit = drafts.commitDocumentDraft(current, draft)
            if (commit.ok) {
              commits += 1
              current = commit.commit.snapshot
            }
            return commit
          },
        },
      })
      if (!factory.ok) throw new Error(factory.diagnostic.message)
      const host = factory.host
      const actor = { type: "mcp", clientId: "org.vibeshape.worker-test", sessionId: id(4) }
      const request = { schemaVersion: 1, draftId: id(3) }
      const apply = (kind: string, revision: number, payload: unknown) =>
        host.applyCommand(actor, {
          ...request,
          command: {
            kind,
            schemaVersion: 1,
            commandId: id(100 + revision),
            documentId: id(1),
            baseRevision: revision,
            issuedAt: "2026-09-07T00:00:01Z",
            actor,
            payload,
          },
        })
      try {
        const created = await host.createDraft(actor, {
          schemaVersion: 1,
          documentId: id(1),
          baseRevision: 1,
        })
        if (!created.ok) throw new Error(created.diagnostic.message)
        const original = await host.previewDraft(actor, request)
        const fillet = domain.featureRecordSchema.parse({
          ...box,
          id: id(5),
          type: domain.filletFeatureType.type,
          parameters: { radius: quantity(100) },
          dependencies: [box.id],
          label: "Draft fillet",
        })
        const added = await apply("org.vibeshape.feature.add", 1, { feature: fillet })
        if (!added.ok) throw new Error(added.diagnostic.message)
        const invalid = await host.previewDraft(actor, request)
        const rejected = await host.commitDraft(actor, request)
        const commitsBeforeRepair = commits
        const repaired = await apply("org.vibeshape.feature.update", 2, {
          feature: { ...fillet, parameters: { radius: quantity(1) } },
        })
        if (!repaired.ok) throw new Error(repaired.diagnostic.message)
        const corrected = await host.previewDraft(actor, request)
        const committed = await host.commitDraft(actor, request)
        return {
          original,
          invalid,
          rejected,
          commitsBeforeRepair,
          corrected,
          committed,
          commits,
          revision: current.revision,
          createdWorkers,
          terminatedWorkers,
        }
      } finally {
        preview.dispose()
      }
    },
    {
      domain: source("packages/domain/src/index.ts"),
      drafts: source("packages/domain/src/drafts.ts"),
      application: source("packages/application/src/disposable-document-preview.ts"),
      worker: source("packages/document-worker/src/session.ts"),
      host: source("packages/automation-host/src/host.ts"),
      queries: source("packages/automation-api/src/queries.ts"),
    },
  )
  expect(result.original).toMatchObject({
    ok: true,
    value: {
      schemaVersion: 2,
      geometry: {
        status: "valid",
        measurements: {
          data: { features: [{ shape: { volume: 6000, surfaceArea: 2200 } }], total: 1 },
        },
      },
    },
  })
  expect(result.invalid).toMatchObject({
    ok: true,
    value: {
      geometry: { status: "invalid", measurements: { data: { features: [{ status: "failed" }] } } },
    },
  })
  expect(result.rejected).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-geometry-invalid" },
  })
  expect(result.commitsBeforeRepair).toBe(0)
  expect(result.corrected).toMatchObject({ ok: true, value: { geometry: { status: "valid" } } })
  if (!result.corrected.ok) throw new Error("Expected corrected geometry.")
  const measured = result.corrected.value.geometry.measurements.data.features[0]
  if (measured?.status !== "succeeded") throw new Error("Expected a measured corrected output.")
  expect(measured.shape.volume).toBeGreaterThan(0)
  expect(measured.shape.volume).toBeLessThan(6000)
  expect(result.committed).toMatchObject({ ok: true, value: { revision: 3, commandCount: 2 } })
  expect(result.commits).toBe(1)
  expect(result.revision).toBe(3)
  expect(result.createdWorkers).toBe(5)
  expect(result.terminatedWorkers).toBe(5)
  await expect(page.getByRole("treeitem", { name: "Draft fillet", exact: true })).toHaveCount(0)
})
