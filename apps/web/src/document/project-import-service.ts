import { generateUuidV7 } from "@vibeshape/domain"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { readAuthoredVShape } from "@vibeshape/formats/vshape"
import { VibeShapeDatabase } from "@vibeshape/persistence"
import {
  type BrowserPortableProject,
  copyBrowserPortableProject,
  portableProjectFromArchive,
} from "./authored-project-file"
import { BrowserProjectRepository } from "./browser-project-repository"
import {
  type ProjectDuplicateRequest,
  type ProjectImportResponse,
  projectImportRequestSchema,
} from "./project-import-contract"

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

function prepareWritableCopy(
  source: BrowserPortableProject,
  request: Pick<ProjectDuplicateRequest, "jobId" | "documentId" | "name" | "issuedAt">,
): PreparationResponse {
  const copied = copyBrowserPortableProject({
    source,
    documentId: request.documentId,
    name: request.name,
    issuedAt: request.issuedAt,
    nextCommandId: nextId,
    nextTransactionId: () => draftIdSchema.parse(nextId()),
  })
  const envelope = { schemaVersion: 0 as const, jobId: request.jobId }
  return copied.ok
    ? { ...envelope, kind: "prepared", value: copied.value }
    : { ...envelope, kind: "error", diagnostic: copied.diagnostic }
}

async function prepareSavedProjectCopy(
  request: ProjectDuplicateRequest,
): Promise<PreparationResponse> {
  const database = new VibeShapeDatabase(request.databaseName)
  const envelope = { schemaVersion: 0 as const, jobId: request.jobId }
  try {
    const portable = await new BrowserProjectRepository(database).exportPortableProject(
      request.sourceDocumentId,
    )
    if (!portable.ok) return { ...envelope, kind: "error", diagnostic: portable.diagnostic }
    const { snapshot } = portable.value.project
    if (
      snapshot.id !== request.sourceDocumentId ||
      snapshot.revision !== request.expectedHeadRevision
    )
      return {
        ...envelope,
        kind: "error",
        diagnostic: {
          code: "stale-revision",
          message: "The project changed before it was copied.",
        },
      }
    return prepareWritableCopy(portable.value, request)
  } finally {
    database.close()
  }
}

// One disposable worker prepares one writable copy from an archive or a saved project.
export function createProjectImportPreparation() {
  let source: BrowserPortableProject | null = null
  let jobId: string | null = null
  let phase: "decode" | "decoding" | "copy" | "done" = "decode"
  const claimPhase = (expected: typeof phase, next: typeof phase) => {
    if (phase !== expected) throw new Error("The native project import phase is invalid.")
    phase = next
  }
  return async (input: unknown): Promise<PreparationResponse> => {
    const request = projectImportRequestSchema.parse(input)
    const envelope = { schemaVersion: 0 as const, jobId: request.jobId }
    if (request.kind === "duplicate") {
      claimPhase("decode", "done")
      return prepareSavedProjectCopy(request)
    }
    if (request.kind === "decode") {
      claimPhase("decode", "decoding")
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
    if (request.jobId !== jobId || !source)
      throw new Error("The native project import phase is invalid.")
    claimPhase("copy", "done")
    const original = source
    source = null
    return prepareWritableCopy(original, request)
  }
}
