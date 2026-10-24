import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const root = resolve(import.meta.dirname, "../..")

test("native import preparation and motion ZIP packaging use real browser workers", async ({
  page,
}) => {
  await page.route("**/async-preparation-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Async preparation</title>",
    }),
  )
  await page.goto("/async-preparation-evidence.html")
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const evidence = await page.evaluate(async (root) => {
    const formats: typeof import("../../packages/formats/src/vshape") = await import(
      `/@fs${root}/packages/formats/src/vshape.ts`
    )
    const fixtures: typeof import("../../scripts/authority-persistence-fixture") = await import(
      `/@fs${root}/scripts/authority-persistence-fixture.ts`
    )
    const persistence: typeof import("../../packages/persistence/src/database") &
      typeof import("../../packages/persistence/src/versioned-repository") = await import(
      `/@fs${root}/packages/persistence/src/index.ts`
    )
    const identifiers: typeof import("../../packages/domain/src/identifiers") = await import(
      `/@fs${root}/packages/domain/src/identifiers.ts`
    )
    const importer: typeof import("../../apps/web/src/document/project-import-client") =
      await import(`/@fs${root}/apps/web/src/document/project-import-client.ts`)
    const archiver: typeof import("../../apps/web/src/features/assembly/assembly-motion-archive") =
      await import(`/@fs${root}/apps/web/src/features/assembly/assembly-motion-archive.ts`)
    const zip: typeof import("fflate") = await import(
      `/@fs${root}/node_modules/fflate/esm/browser.js`
    )
    const { created, added, upgraded, renamed } = fixtures.authorityFixture()
    const encoded = await formats.writeVShapeV3({
      snapshot: renamed.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: [created.event, added.event, upgraded.event, renamed.event],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: upgraded.snapshot.revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
      exportedAt: fixtures.authorityTimestamp,
      createdBy: { application: "VibeShape", version: "test", build: null },
      engine: null,
    })
    if (!encoded.ok) throw new Error(encoded.diagnostic.message)
    const bytes = encoded.value
    const inputLength = bytes.byteLength
    const documentId = identifiers.documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000222")
    const database = new persistence.VibeShapeDatabase(`async-preparation-${crypto.randomUUID()}`)
    const repository = new persistence.VersionedLocalDocumentRepository(database)
    let ticks = 0
    const timer = setInterval(() => ticks++, 0)
    try {
      const prepared = await importer.prepareProjectImport({
        bytes,
        documentId,
        issuedAt: fixtures.authorityTimestamp,
        resolveName: (name) => `${name} copy`,
        signal: new AbortController().signal,
      })
      if (!prepared.ok) throw new Error(prepared.diagnostic.message)
      const beforePublication = await database.projectsV1.count()
      if (prepared.value.version !== 3)
        throw new Error("The fixture requires a version-three copy.")
      const stored = await repository.copyPortableProjectV3({
        ...prepared.value.project,
        copiedAt: fixtures.authorityTimestamp,
      })
      if (!stored.ok) throw new Error(stored.diagnostic.message)
      const recovered = await repository.recoverAuthority(documentId)
      if (!recovered.ok) throw new Error(recovered.diagnostic.message)
      const files = {
        "motion.json": new TextEncoder().encode('{"revision":7}'),
        "frame-0001.png": new Uint8Array([137, 80, 78, 71]),
      }
      const archive = await archiver.archiveAssemblyMotionFrames(
        files,
        new AbortController().signal,
      )
      const contents = zip.unzipSync(archive)
      return {
        ticks,
        inputPreserved: bytes.byteLength === inputLength,
        beforePublication,
        storedId: recovered.value.snapshot.id,
        name: recovered.value.snapshot.name,
        featureIds: recovered.value.snapshot.features.map(({ id }) => id),
        sourceFeatureIds: renamed.snapshot.features.map(({ id }) => id),
        archiveNames: Object.keys(contents),
        archiveManifest: new TextDecoder().decode(contents["motion.json"]),
        archivedFrame: Array.from(contents["frame-0001.png"] ?? []),
        frameTransferred: files["frame-0001.png"].byteLength === 0,
      }
    } finally {
      clearInterval(timer)
      await database.delete()
    }
  }, root)
  expect(evidence.ticks).toBeGreaterThan(0)
  expect(evidence.inputPreserved).toBe(true)
  expect(evidence.beforePublication).toBe(0)
  expect(evidence.storedId).toBe("0195b5ac-b250-7a2c-8c33-000000000222")
  expect(evidence.name).toMatch(/ copy$/)
  expect(evidence.featureIds).toEqual(evidence.sourceFeatureIds)
  expect(evidence.archiveNames).toEqual(["motion.json", "frame-0001.png"])
  expect(evidence.archiveManifest).toBe('{"revision":7}')
  expect(evidence.archivedFrame).toEqual([137, 80, 78, 71])
  expect(evidence.frameTransferred).toBe(true)
  expect(errors).toEqual([])
})
