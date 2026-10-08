import { expect, it } from "bun:test"
import { localOperationSchema, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import { vi } from "../../../../tests/unit/support/bun-test"
import { inspection } from "../features/import/import-test-fixtures"
import { createImportUploadSession } from "./import-upload-session"
import { createLocalToolExecutor } from "./local-tool-executor"
import {
  planarActor as actor,
  planarContext as context,
  planarId as id,
  realPlanarInspection,
} from "./planar-import-test-fixtures"
import { createPlanarImportUploadSession } from "./planar-import-upload-session"

it("evicts the other owned source only after a valid new begin, without invalid requests discarding reusable bytes", async () => {
  let ordinal = 100
  const common = {
    documentId: context.documentId,
    isActive: () => true,
    readContext: () => context,
    createId: () => id(ordinal++),
    review: async () => "approved" as const,
    commit: async () => ({ ok: true as const, value: { revision: 6 } }),
  }
  const imports = createImportUploadSession({ ...common, inspect: async () => inspection }),
    planarImports = createPlanarImportUploadSession({ ...common, inspect: realPlanarInspection })
  const executor = createLocalToolExecutor(
    {
      documentId: context.documentId,
      revision: context.revision,
      host: {
        createDraft: vi.fn(),
        inspectDraft: vi.fn(),
        applyCommand: vi.fn(),
        previewDraft: vi.fn(),
        commitDraft: vi.fn(),
        discardDraft: vi.fn(),
      },
      imports,
      planarImports,
      readCad: vi.fn(),
      readInfo: () => null,
      exportRevisionBound: vi.fn(),
    },
    actor,
  )
  const call = (tool: string, args: Record<string, unknown>) =>
    executor.execute(localOperationSchema.parse({ tool, arguments: args }))
  try {
    const native = localToolOutputs.begin_import_upload.parse(
      await call("begin_import_upload", {
        revision: 4,
        filename: "source.step",
        byteLength: 3,
        sourceUnit: "millimeter",
      }),
    )
    if (!native.ok || !("uploadId" in native.value)) throw new Error("Missing native upload.")
    expect(
      await call("begin_planar_import_upload", {
        revision: 3,
        filename: "outline.svg",
        byteLength: 3,
        unit: "mm",
        plane: "xy",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(
      await call("append_import_chunk", {
        uploadId: native.value.uploadId,
        offset: 0,
        base64: "AQID",
      }),
    ).toMatchObject({ ok: true })
    const planar = localToolOutputs.begin_planar_import_upload.parse(
      await call("begin_planar_import_upload", {
        revision: 4,
        filename: "outline.svg",
        byteLength: 3,
        unit: "mm",
        plane: "xy",
      }),
    )
    if (!planar.ok || !("uploadId" in planar.value)) throw new Error("Missing planar upload.")
    expect(await call("inspect_import_upload", { uploadId: native.value.uploadId })).toMatchObject({
      ok: false,
      diagnostic: { code: "import-upload-unavailable" },
    })
    expect(
      await call("begin_import_upload", {
        revision: 3,
        filename: "source.step",
        byteLength: 3,
        sourceUnit: "millimeter",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(
      await call("append_planar_import_chunk", {
        uploadId: planar.value.uploadId,
        offset: 0,
        base64: "AQID",
      }),
    ).toMatchObject({ ok: true })
    expect(
      await call("begin_import_upload", {
        revision: 4,
        filename: "source.step",
        byteLength: 3,
        sourceUnit: "millimeter",
      }),
    ).toMatchObject({ ok: true })
    expect(
      await call("inspect_planar_import_upload", { uploadId: planar.value.uploadId }),
    ).toMatchObject({ ok: false, diagnostic: { code: "import-upload-unavailable" } })
  } finally {
    imports.dispose()
    planarImports.dispose()
  }
})
