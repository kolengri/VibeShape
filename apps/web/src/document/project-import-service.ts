import { generateUuidV7 } from "@vibeshape/domain"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { readAuthoredVShape } from "@vibeshape/formats/vshape"
import {
  type BrowserPortableProject,
  copyBrowserPortableProject,
  portableProjectFromArchive,
} from "./authored-project-file"
import { type ProjectImportResponse, projectImportRequestSchema } from "./project-import-contract"

function nextId() {
  return generateUuidV7({
    timestampMs: Date.now(),
    randomBytes: crypto.getRandomValues(new Uint8Array(10)),
  })
}

type PreparationResponse =
  | Exclude<ProjectImportResponse, { kind: "prepared" }>
  | {
      schemaVersion: 0
      jobId: string
      kind: "prepared"
      value: BrowserPortableProject
    }

async function decodePortableProject(bytes: Uint8Array) {
  const decoded = await readAuthoredVShape(bytes)
  return decoded.ok ? portableProjectFromArchive(decoded.value) : decoded
}

// One disposable worker owns one decoded archive through the naming round trip.
export function createProjectImportPreparation() {
  let source: BrowserPortableProject | null = null
  let jobId: string | null = null
  let phase: "decode" | "decoding" | "copy" | "done" = "decode"
  return async (input: unknown): Promise<PreparationResponse> => {
    const request = projectImportRequestSchema.parse(input)
    const envelope = { schemaVersion: 0 as const, jobId: request.jobId }
    if (request.kind === "decode" && phase === "decode") {
      phase = "decoding"
      jobId = request.jobId
      const portable = await decodePortableProject(request.bytes)
      if (!portable.ok) {
        phase = "done"
        return { ...envelope, kind: "error", diagnostic: portable.diagnostic }
      }
      source = portable.value
      phase = "copy"
      return { ...envelope, kind: "name", sourceName: source.project.snapshot.name }
    }
    if (request.kind !== "copy" || phase !== "copy" || request.jobId !== jobId || !source)
      throw new Error("The native project import phase is invalid.")
    phase = "done"
    const original = source
    source = null
    const copied = copyBrowserPortableProject({
      source: original,
      documentId: request.documentId,
      name: request.name,
      issuedAt: request.issuedAt,
      nextCommandId: nextId,
      nextTransactionId: () => draftIdSchema.parse(nextId()),
    })
    return copied.ok
      ? { ...envelope, kind: "prepared", value: copied.value }
      : { ...envelope, kind: "error", diagnostic: copied.diagnostic }
  }
}
