import { documentIdSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { VSHAPE_MAX_ARCHIVE_BYTES } from "@vibeshape/formats/vshape"
import { z } from "zod"
import {
  type PreparedProjectImport,
  type ProjectDuplicateRequest,
  projectImportRequestSchema,
  projectImportResponseSchema,
} from "./project-import-contract"

function createImportWorker() {
  return new Worker(new URL("./project-import-worker.ts", import.meta.url), { type: "module" })
}

const preparedIdentitySchema = z.object({
  snapshot: z.object({
    id: documentIdSchema,
    name: z.string(),
    revision: z.number().int().positive().safe(),
  }),
  historyMode: z.literal("complete"),
})

type ImportInput = {
  bytes: Uint8Array
  documentId: z.infer<typeof documentIdSchema>
  issuedAt: string
  resolveName: (sourceName: string) => string
  signal: AbortSignal
}
type DuplicateInput = Omit<ProjectDuplicateRequest, "schemaVersion" | "kind" | "jobId"> & {
  signal: AbortSignal
}
type PreparationInput =
  | ({ kind: "import" } & ImportInput)
  | ({ kind: "duplicate" } & DuplicateInput)

export function prepareProjectImport(input: ImportInput, createWorker = createImportWorker) {
  return prepareProjectCopy({ ...input, kind: "import" }, createWorker)
}

export function prepareProjectDuplicate(input: DuplicateInput, createWorker = createImportWorker) {
  return prepareProjectCopy({ ...input, kind: "duplicate" }, createWorker)
}

function initialRequest(input: PreparationInput, jobId: string) {
  if (input.kind === "import")
    return projectImportRequestSchema.parse({
      schemaVersion: 0,
      jobId,
      kind: "decode",
      bytes: input.bytes,
    })
  const { signal: _signal, ...request } = input
  return projectImportRequestSchema.parse({ ...request, schemaVersion: 0, jobId })
}

function prepareProjectCopy(
  input: PreparationInput,
  createWorker = createImportWorker,
): Promise<
  | { ok: true; value: PreparedProjectImport }
  | { ok: false; diagnostic: { code: string; message: string } }
> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null
    let timeout: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let name: string | null = input.kind === "duplicate" ? input.name : null
    const jobId = crypto.randomUUID()
    const cleanup = () => {
      settled = true
      clearTimeout(timeout)
      input.signal.removeEventListener("abort", abort)
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
      }
    }
    const fail = (error: unknown) => {
      if (!settled) {
        cleanup()
        reject(error)
      }
    }
    const abort = () =>
      fail(new DOMException("The native project import was cancelled.", "AbortError"))
    const resolveCopyName = (sourceName: string) => {
      if (input.kind !== "import" || name !== null)
        throw new Error("The import worker repeated its naming phase.")
      name = input.resolveName(sourceName)
      if (settled) return
      worker?.postMessage(
        projectImportRequestSchema.parse({
          schemaVersion: 0,
          jobId,
          kind: "copy",
          documentId: input.documentId,
          name,
          issuedAt: input.issuedAt,
        }),
      )
    }
    const acceptCopy = (value: PreparedProjectImport) => {
      const identity = preparedIdentitySchema.safeParse(value.project)
      if (
        name === null ||
        !identity.success ||
        identity.data.snapshot.id !== input.documentId ||
        identity.data.snapshot.name !== name
      )
        throw new Error("The import worker returned a different project copy.")
      cleanup()
      resolve({ ok: true, value })
    }
    if (input.signal.aborted) {
      abort()
      return
    }
    input.signal.addEventListener("abort", abort, { once: true })
    try {
      if (input.kind === "import" && input.bytes.byteLength > VSHAPE_MAX_ARCHIVE_BYTES) {
        cleanup()
        resolve({
          ok: false,
          diagnostic: {
            code: "resource-limit",
            message: "The archive exceeds the compressed-size limit.",
          },
        })
        return
      }
      const request = initialRequest(input, jobId)
      documentIdSchema.parse(input.documentId)
      timestampSchema.parse(input.issuedAt)
      worker = createWorker()
      if (settled) {
        worker.terminate()
        return
      }
      timeout = setTimeout(() => fail(new Error("The native project import timed out.")), 300_000)
      worker.onerror = () => fail(new Error("The native project import worker could not run."))
      worker.onmessageerror = () =>
        fail(new Error("The native project import could not be received."))
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return
        try {
          const response = projectImportResponseSchema.safeParse(event.data)
          if (!response.success || response.data.jobId !== jobId)
            throw new Error("The import worker returned an invalid response.")
          const result = response.data
          if (result.kind === "error") {
            cleanup()
            resolve({ ok: false, diagnostic: result.diagnostic })
            return
          }
          if (result.kind === "name") {
            resolveCopyName(result.sourceName)
            return
          }
          acceptCopy(result.value)
        } catch (error) {
          fail(error)
        }
      }
      // Own the transferred copy; callers may reuse their input after success, failure, or cancellation.
      if (request.kind === "decode") {
        const bytes = Uint8Array.from(request.bytes)
        worker.postMessage({ ...request, bytes }, [bytes.buffer])
      } else worker.postMessage(request)
    } catch (error) {
      fail(error)
    }
  })
}
