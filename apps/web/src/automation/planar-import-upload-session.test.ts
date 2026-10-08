import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  IMPORT_UPLOAD_TTL_MS,
} from "@vibeshape/automation-api/imports"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import {
  isLocalPlanarImport,
  type PlanarUploadDescriptor,
  type PlanarUploadInspection,
} from "@vibeshape/automation-api/planar-imports"
import { vi } from "../../../../tests/unit/support/bun-test"
import { matchValue } from "../../../../tests/unit/support/match-value"
import {
  planarActor as actor,
  planarContext as context,
  planarDxf as dxf,
  planarId as id,
  realPlanarInspection,
  planarSvg as svg,
} from "./planar-import-test-fixtures"
import {
  createPlanarImportUploadSession,
  type PlanarImportSessionConfiguration,
} from "./planar-import-upload-session"

const sessions: ReturnType<typeof createPlanarImportUploadSession>[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function setup(overrides: Partial<PlanarImportSessionConfiguration> = {}) {
  let ordinal = 100,
    revision = context.revision
  const inspect = vi.fn(realPlanarInspection)
  const review = vi.fn<PlanarImportSessionConfiguration["review"]>(async () => "approved")
  const commit = vi.fn<PlanarImportSessionConfiguration["commit"]>(async () => ({
    ok: true,
    value: { revision: revision + 2 },
  }))
  const session = createPlanarImportUploadSession({
    documentId: context.documentId,
    isActive: () => true,
    readContext: () => ({ ...context, revision }),
    createId: () => id(ordinal++),
    inspect,
    review,
    commit,
    ...overrides,
  })
  sessions.push(session)
  const call = (
    tool: string,
    args: Record<string, unknown>,
    inputActor: unknown = actor,
    signal?: AbortSignal,
  ) => {
    const operation = localOperationSchema.parse({ tool, arguments: args })
    if (!isLocalPlanarImport(operation)) throw new Error("Expected planar import.")
    return session.execute(inputActor, operation, signal)
  }
  const begin = async (text = svg, filename = "source.svg", unit = "mm", plane = "xz") => {
    const bytes = Buffer.from(text),
      upload = success(
        await call("begin_planar_import_upload", {
          revision,
          filename,
          byteLength: bytes.length,
          unit,
          plane,
        }),
      ) as PlanarUploadDescriptor
    for (let offset = 0; offset < bytes.length; offset += IMPORT_UPLOAD_CHUNK_MAX_BYTES)
      success(
        await call("append_planar_import_chunk", {
          uploadId: upload.uploadId,
          offset,
          base64: bytes.subarray(offset, offset + IMPORT_UPLOAD_CHUNK_MAX_BYTES).toString("base64"),
        }),
      )
    return upload
  }
  const ready = async () => {
    const upload = await begin()
    return success(
      await call("inspect_planar_import_upload", { uploadId: upload.uploadId }),
    ) as PlanarUploadInspection
  }
  return { session, call, begin, ready, inspect, review, commit, changeRevision: () => revision++ }
}
function success(
  result: Awaited<ReturnType<ReturnType<typeof createPlanarImportUploadSession>["execute"]>>,
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
describe("actor-owned planar source capture", () => {
  it.each([
    ["source.svg", svg, "mm", "selected", 1],
    ["circle.dxf", dxf, "declared", "declared", 25.4],
  ] as const)(
    "captures %s units, plane and editable sketch identities without publishing before review",
    async (filename, text, unit, policy, scale) => {
      const test = setup(),
        upload = await test.begin(text, filename, unit),
        view = success(
          await test.call("inspect_planar_import_upload", { uploadId: upload.uploadId }),
        ) as PlanarUploadInspection
      expect(view).toMatchObject({
        upload: {
          format: filename.split(".").at(-1),
          plane: "xz",
          sha256: createHash("sha256").update(text).digest("hex"),
        },
        unitPolicy: policy,
        normalization: { scaleToMillimeters: scale },
        closedPaths: 1,
      })
      expect(test.commit).not.toHaveBeenCalled()
      expect(test.review).not.toHaveBeenCalled()
      expect(
        success(await test.call("inspect_planar_import_upload", { uploadId: upload.uploadId })),
      ).toEqual(view)
      const result = await test.call("commit_planar_import_upload", {
        uploadId: upload.uploadId,
        uploadVersion: view.upload.uploadVersion,
      })
      expect(result).toMatchObject({
        ok: true,
        value: { sketchId: view.sketchId, pathOutputs: view.pathOutputs },
      })
      const committed = test.commit.mock.calls[0]?.[0]
      expect(
        committed?.transaction.commands.every(
          (command) => JSON.stringify(command.actor) === JSON.stringify(actor),
        ),
      ).toBe(true)
      expect(committed?.transaction.commands.at(-1)).toMatchObject({
        kind: "org.vibeshape.history.insert-sketch",
        payload: { sketch: { id: view.sketchId, plane: "xz", sourceImport: {} } },
      })
      expect(committed?.assetBlobs[0]?.bytes).toEqual(new Uint8Array(Buffer.from(text)))
    },
  )
  it("rejects unsupported elements with the existing parser diagnostic and no partial authoring", async () => {
    const test = setup(),
      upload = await test.begin(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>Rejected</text></svg>',
      )
    expect(
      await test.call("inspect_planar_import_upload", { uploadId: upload.uploadId }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsupported-geometry" } })
    expect(test.review).not.toHaveBeenCalled()
    expect(test.commit).not.toHaveBeenCalled()
  })
  it("pins the actor and exact base and releases expired or explicitly discarded bytes", async () => {
    vi.useFakeTimers()
    const test = setup(),
      upload = await test.begin()
    expect(
      await test.call(
        "inspect_planar_import_upload",
        { uploadId: upload.uploadId },
        { ...actor, sessionId: id(91) },
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    expect(
      await test.call(
        "inspect_planar_import_upload",
        { uploadId: upload.uploadId },
        { type: "user", userId: null },
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    await vi.advanceTimersByTimeAsync(IMPORT_UPLOAD_TTL_MS)
    expect(
      await test.call("inspect_planar_import_upload", { uploadId: upload.uploadId }),
    ).toMatchObject({ ok: false, diagnostic: { code: "import-upload-unavailable" } })
    expect(
      success(await test.call("discard_planar_import_upload", { uploadId: upload.uploadId })),
    ).toEqual({ uploadId: upload.uploadId, discarded: true })
  })
  it("rejects stale or mismatched previews, reparsed geometry changes and rejected manual review", async () => {
    const test = setup(),
      view = await test.ready(),
      args = { uploadId: view.upload.uploadId, uploadVersion: view.upload.uploadVersion }
    expect(
      await test.call("commit_planar_import_upload", { ...args, uploadVersion: 0 }),
    ).toMatchObject({ ok: false, diagnostic: { code: "import-preview-required" } })
    test.inspect.mockImplementationOnce(async (source) => {
      const result = await realPlanarInspection(source)
      if (result.ok) result.bounds.max[0]++
      return result
    })
    expect(await test.call("commit_planar_import_upload", args)).toMatchObject({
      ok: false,
      diagnostic: { code: "import-source-changed" },
    })
    test.review.mockResolvedValueOnce("rejected")
    expect(await test.call("commit_planar_import_upload", args)).toMatchObject({
      ok: false,
      diagnostic: { code: "import-review-cancelled" },
    })
    test.changeRevision()
    expect(await test.call("commit_planar_import_upload", args)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(test.commit).not.toHaveBeenCalled()
  })
  it("owns defensive copies and retains accepted persistence after disconnect", async () => {
    let finish = (_value: Awaited<ReturnType<PlanarImportSessionConfiguration["commit"]>>) => {}
    const test = setup({
        commit: async () =>
          new Promise((done) => {
            finish = done
          }),
      }),
      view = await test.ready(),
      savedVersion = view.upload.uploadVersion
    view.pathOutputs.splice(0)
    view.upload.uploadVersion = 99
    const pending = test.call("commit_planar_import_upload", {
      uploadId: view.upload.uploadId,
      uploadVersion: savedVersion,
    })
    await vi.waitFor(() => expect(test.session.isPersisting()).toBe(true))
    test.session.dispose()
    finish({ ok: true, value: { revision: 11 } })
    expect(matchValue(matchValue(await pending))).toMatchObject({
      ok: true,
      value: { revision: 11, pathOutputs: expect.arrayContaining([expect.any(String)]) },
    })
  })
  it("handles exact chunk retries without renewing expiry, rejects conflicts and ignores late inspection after cancellation", async () => {
    const test = setup(),
      upload = await test.begin(),
      chunk = { uploadId: upload.uploadId, offset: 0, base64: Buffer.from(svg).toString("base64") }
    const current = success(await test.call("append_planar_import_chunk", chunk))
    expect(success(await test.call("append_planar_import_chunk", chunk))).toEqual(current)
    expect(
      await test.call("append_planar_import_chunk", {
        ...chunk,
        base64: Buffer.alloc(Buffer.byteLength(svg), 2).toString("base64"),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "import-chunk-conflict" } })
    let finish = (_value: Awaited<ReturnType<typeof realPlanarInspection>>) => {}
    let running = false
    test.inspect.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
          running = true
        }),
    )
    const pending = test.call("inspect_planar_import_upload", { uploadId: upload.uploadId })
    await vi.waitFor(() => expect(running).toBe(true))
    test.session.cancel()
    finish(
      await realPlanarInspection({
        input: { format: "svg", bytes: new Uint8Array(Buffer.from(svg)), units: "mm" },
      }),
    )
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "import-cancelled" } })
  })
})
