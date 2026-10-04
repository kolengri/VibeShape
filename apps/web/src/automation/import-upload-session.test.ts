// @vitest-environment node
import { createHash } from "node:crypto"
import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  IMPORT_UPLOAD_TTL_MS,
  type ImportUploadDescriptor,
  type ImportUploadInspection,
} from "@vibeshape/automation-api/imports"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { afterEach, describe, expect, it, vi } from "vitest"
import { context, id, inspection, meshInspection } from "../features/import/import-test-fixtures"
import {
  createImportUploadSession,
  type ImportReviewedCommit,
  type ImportSessionConfiguration,
} from "./import-upload-session"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.import",
  sessionId: id(90),
})
const sessions: ReturnType<typeof createImportUploadSession>[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function success(
  result: Awaited<ReturnType<ReturnType<typeof createImportUploadSession>["execute"]>>,
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a captured output.")
  return value
}
function setup(overrides: Partial<ImportSessionConfiguration> = {}) {
  let ordinal = 100
  let revision = context.revision
  const inspect = vi.fn(async () => structuredClone(inspection))
  const review = vi.fn<ImportSessionConfiguration["review"]>(async () => "approved")
  const commit = vi.fn<ImportSessionConfiguration["commit"]>(async () => ({
    ok: true,
    value: { revision: revision + 4 },
  }))
  const session = createImportUploadSession({
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
    inputActor = actor,
    signal?: AbortSignal,
  ) => {
    const operation = localOperationSchema.parse({ tool, arguments: args })
    if (!tool.includes("import")) throw new Error("Expected an import operation.")
    // The discriminant is validated before the session receives this bounded operation.
    if (
      operation.tool !== "begin_import_upload" &&
      operation.tool !== "append_import_chunk" &&
      operation.tool !== "inspect_import_upload" &&
      operation.tool !== "commit_import_upload" &&
      operation.tool !== "discard_import_upload"
    )
      throw new Error("Expected import.")
    return session.execute(inputActor, operation, signal)
  }
  const begin = async (
    bytes = new Uint8Array([1, 2, 3]),
    filename = "source.step",
    sourceUnit: "millimeter" | null = "millimeter",
  ) => {
    const upload = success(
      await call("begin_import_upload", {
        revision,
        filename,
        byteLength: bytes.length,
        sourceUnit,
      }),
    ) as ImportUploadDescriptor
    for (let offset = 0; offset < bytes.length; offset += IMPORT_UPLOAD_CHUNK_MAX_BYTES) {
      success(
        await call("append_import_chunk", {
          uploadId: upload.uploadId,
          offset,
          base64: Buffer.from(
            bytes.subarray(offset, offset + IMPORT_UPLOAD_CHUNK_MAX_BYTES),
          ).toString("base64"),
        }),
      )
    }
    return upload
  }
  const ready = async () => {
    const upload = await begin()
    return success(
      await call("inspect_import_upload", { uploadId: upload.uploadId }),
    ) as ImportUploadInspection
  }
  return { session, call, begin, ready, inspect, review, commit, changeRevision: () => revision++ }
}

describe("actor-owned native import capture", () => {
  it("does not start a native worker after cancellation during byte hashing", async () => {
    let resolve = (_value: ArrayBuffer) => {}
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((done) => {
          resolve = done
        }),
    )
    const test = setup()
    const upload = await test.begin()
    const pending = test.call("inspect_import_upload", { uploadId: upload.uploadId })
    await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(1))
    test.session.cancel()
    resolve(
      Uint8Array.from(
        createHash("sha256")
          .update(new Uint8Array([1, 2, 3]))
          .digest(),
      ).buffer,
    )
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "import-cancelled" } })
    expect(test.inspect).not.toHaveBeenCalled()
  })
  it("computes SHA and stable output roles, then commits one actor-authored source closure", async () => {
    const test = setup()
    const captured = await test.ready()
    expect(captured.upload.sha256).toBe(
      createHash("sha256")
        .update(new Uint8Array([1, 2, 3]))
        .digest("hex"),
    )
    expect(test.commit).not.toHaveBeenCalled()
    expect(captured.outputs[0]).toMatchObject({
      volumeMm3: 1000,
      surfaceAreaMm2: 600,
      triangleCount: 1,
    })
    const result = success(
      await test.call("commit_import_upload", {
        uploadId: captured.upload.uploadId,
        uploadVersion: captured.upload.uploadVersion,
      }),
    )
    expect(result).toMatchObject({
      featureId: captured.featureId,
      outputRoles: captured.outputs.map((output) => output.outputRole),
      uploadVersion: captured.upload.uploadVersion,
    })
    expect(test.inspect).toHaveBeenCalledTimes(2)
    const committed = test.commit.mock.calls[0]?.[0]
    expect(committed?.transaction.transactionId).toBe(captured.upload.uploadId)
    expect(committed?.transaction.commands.map((command) => command.actor)).toEqual(
      Array(4).fill(actor),
    )
    expect(committed?.assetBlobs?.[0]).toMatchObject({
      digest: captured.upload.sha256,
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(
      await test.call("inspect_import_upload", { uploadId: captured.upload.uploadId }),
    ).toMatchObject({ ok: false, diagnostic: { code: "import-upload-unavailable" } })
  })
  it.each(["source.stl", "source.3mf"])(
    "keeps %s mesh bounds and declared normalization without inventing solid volume",
    async (filename) => {
      const test = setup({ inspect: async () => structuredClone(meshInspection) })
      const upload = await test.begin(
        undefined,
        filename,
        filename.endsWith("3mf") ? null : "millimeter",
      )
      const captured = success(
        await test.call("inspect_import_upload", { uploadId: upload.uploadId }),
      ) as ImportUploadInspection
      expect(captured).toMatchObject({
        representation: "triangle-mesh",
        normalization: meshInspection.normalization,
        outputs: [
          { volumeMm3: null, surfaceAreaMm2: 50, bounds: meshInspection.outputs[0]?.shape.bounds },
        ],
      })
      expect(
        success(
          await test.call("commit_import_upload", {
            uploadId: upload.uploadId,
            uploadVersion: captured.upload.uploadVersion,
          }),
        ),
      ).toMatchObject({ outputRoles: captured.outputs.map((output) => output.outputRole) })
    },
  )
  it("copies native inputs and cached inspection views before crossing ports", async () => {
    const test = setup({
      inspect: async (prepared) => {
        prepared.bytes.fill(99)
        return structuredClone(inspection)
      },
    })
    const captured = await test.ready()
    required(captured.outputs[0]).volumeMm3 = 2
    const second = success(
      await test.call("inspect_import_upload", { uploadId: captured.upload.uploadId }),
    ) as ImportUploadInspection
    expect(second.outputs[0]?.volumeMm3).toBe(1000)
    success(
      await test.call("commit_import_upload", {
        uploadId: captured.upload.uploadId,
        uploadVersion: captured.upload.uploadVersion,
      }),
    )
    expect(test.commit.mock.calls[0]?.[0].assetBlobs?.[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
  it("accepts exact chunk retries without renewing version or expiry and rejects conflicting or out-of-order bytes", async () => {
    const test = setup()
    const bytes = new Uint8Array(IMPORT_UPLOAD_CHUNK_MAX_BYTES + 1).fill(1)
    const upload = success(
      await test.call("begin_import_upload", {
        revision: context.revision,
        filename: "source.step",
        byteLength: bytes.length,
        sourceUnit: "millimeter",
      }),
    ) as ImportUploadDescriptor
    const chunk = {
      uploadId: upload.uploadId,
      offset: 0,
      base64: Buffer.from(bytes.subarray(0, IMPORT_UPLOAD_CHUNK_MAX_BYTES)).toString("base64"),
    }
    const appended = success(await test.call("append_import_chunk", chunk))
    expect(success(await test.call("append_import_chunk", chunk))).toEqual(appended)
    expect(
      await test.call("append_import_chunk", {
        ...chunk,
        base64: Buffer.alloc(IMPORT_UPLOAD_CHUNK_MAX_BYTES, 2).toString("base64"),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "import-chunk-conflict" } })
    expect(await test.call("append_import_chunk", { ...chunk, offset: 1 })).toMatchObject({
      ok: false,
      diagnostic: { code: "import-chunk-conflict" },
    })
    expect(await test.call("append_import_chunk", { ...chunk, base64: "AQ==" })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-import-chunk" },
    })
    expect(await test.call("inspect_import_upload", { uploadId: upload.uploadId })).toMatchObject({
      ok: false,
      diagnostic: { code: "incomplete-import-upload" },
    })
    success(
      await test.call("append_import_chunk", {
        uploadId: upload.uploadId,
        offset: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
        base64: "AQ==",
      }),
    )
    expect(
      success(await test.call("inspect_import_upload", { uploadId: upload.uploadId })),
    ).toMatchObject({ upload: { receivedBytes: bytes.length } })
  })
  it("pins the paired actor and rejects foreign, user and revoked sessions", async () => {
    let active = true
    const test = setup({ isActive: () => active })
    const upload = await test.begin()
    for (const foreign of [
      { ...actor, sessionId: id(91) },
      { type: "user", userId: null },
    ])
      expect(
        await test.call(
          "inspect_import_upload",
          { uploadId: upload.uploadId },
          commandActorSchema.parse(foreign),
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    active = false
    expect(await test.call("inspect_import_upload", { uploadId: upload.uploadId })).toMatchObject({
      ok: false,
      diagnostic: { code: "session-revoked" },
    })
  })
  it("releases expired bytes and makes discard idempotent", async () => {
    vi.useFakeTimers()
    const test = setup()
    const upload = await test.begin()
    await vi.advanceTimersByTimeAsync(IMPORT_UPLOAD_TTL_MS)
    expect(await test.call("inspect_import_upload", { uploadId: upload.uploadId })).toMatchObject({
      ok: false,
      diagnostic: { code: "import-upload-unavailable" },
    })
    expect(
      success(await test.call("discard_import_upload", { uploadId: upload.uploadId })),
    ).toEqual({ uploadId: upload.uploadId, discarded: true })
    expect(
      success(await test.call("discard_import_upload", { uploadId: upload.uploadId })),
    ).toEqual({ uploadId: upload.uploadId, discarded: true })
  })
  it("rejects stale revision, wrong captured version and changed native signatures before review", async () => {
    const test = setup()
    const captured = await test.ready()
    const args = {
      uploadId: captured.upload.uploadId,
      uploadVersion: captured.upload.uploadVersion,
    }
    expect(await test.call("commit_import_upload", { ...args, uploadVersion: 0 })).toMatchObject({
      ok: false,
      diagnostic: { code: "import-preview-required" },
    })
    test.inspect.mockImplementationOnce(async () => {
      const changed = structuredClone(inspection)
      required(changed.outputs[0]).signature.volume = 999
      return changed
    })
    expect(await test.call("commit_import_upload", args)).toMatchObject({
      ok: false,
      diagnostic: { code: "import-source-changed" },
    })
    test.changeRevision()
    expect(await test.call("commit_import_upload", args)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(test.review).not.toHaveBeenCalled()
    expect(test.commit).not.toHaveBeenCalled()
  })
  it.each(["rejected", "cancelled"] as const)(
    "keeps the source temporary when review is %s",
    async (decision) => {
      const test = setup({ review: async () => decision })
      const captured = await test.ready()
      expect(
        await test.call("commit_import_upload", {
          uploadId: captured.upload.uploadId,
          uploadVersion: captured.upload.uploadVersion,
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "import-review-cancelled" } })
      expect(test.commit).not.toHaveBeenCalled()
    },
  )
  it("ignores late native inspection after cancellation and unlocks after failure", async () => {
    let resolve = (_value: typeof inspection) => {}
    let inspecting = false
    const test = setup({
      inspect: () =>
        new Promise((done) => {
          resolve = done
          inspecting = true
        }),
    })
    const upload = await test.begin()
    const pending = test.call("inspect_import_upload", { uploadId: upload.uploadId })
    await vi.waitFor(() => expect(inspecting).toBe(true))
    test.session.cancel()
    resolve(structuredClone(inspection))
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "import-cancelled" } })
    expect(test.commit).not.toHaveBeenCalled()
    expect(
      await test.call("begin_import_upload", {
        revision: context.revision,
        filename: "new.brep",
        byteLength: 1,
        sourceUnit: "millimeter",
      }),
    ).toMatchObject({ ok: true })
  })
  it("preserves an accepted persistence outcome when the paired transport disconnects", async () => {
    let persist = (_value: Awaited<ReturnType<ImportSessionConfiguration["commit"]>>) => {}
    const test = setup({
      commit: async (_input: ImportReviewedCommit) =>
        new Promise((done) => {
          persist = done
        }),
    })
    const captured = await test.ready()
    const pending = test.call("commit_import_upload", {
      uploadId: captured.upload.uploadId,
      uploadVersion: captured.upload.uploadVersion,
    })
    await vi.waitFor(() => expect(test.session.isPersisting()).toBe(true))
    test.session.dispose()
    persist({ ok: true, value: { revision: 11 } })
    expect(await pending).toMatchObject({ ok: true, value: { revision: 11 } })
  })
})
