import { documentIdSchema, sessionIdSchema } from "@vibeshape/domain/identifiers"
import {
  type AuthorityDocumentRepositoryPort,
  type AuthorityRecoveryReport,
  createAuthorityPersistenceAdapter,
} from "./authority-persistence-adapter"
import type { PartAllocationFactory } from "./authority-persistence-operations"
import {
  type DocumentLeasePort,
  openPersistentDocumentSession,
  type PersistentDocumentSessionOpenResult,
  type SessionPortResult,
} from "./persistent-document-session"
import {
  openVersionedDocumentSession,
  type VersionedDocumentSessionDependencies,
  type VersionedPromotionPort,
} from "./versioned-document-session"
import type { VersionedDocumentRepositoryPort } from "./versioned-persistence-adapter"

export type AuthorityDocumentSessionDependencies = Omit<
  VersionedDocumentSessionDependencies,
  "versionedRepository" | "createAdapter"
> &
  Readonly<{
    versionedRepository: AuthorityDocumentRepositoryPort & VersionedPromotionPort
    createPart: PartAllocationFactory
  }>

function cachedAuthorityRepository(
  repository: AuthorityDocumentRepositoryPort,
  recoverFirst: () => Promise<SessionPortResult<AuthorityRecoveryReport>>,
  legacy: VersionedDocumentRepositoryPort = repository,
): AuthorityDocumentRepositoryPort {
  let first = true
  const loadHistoryTarget = repository.loadHistoryTarget?.bind(repository)
  return {
    ...(loadHistoryTarget ? { loadHistoryTarget } : {}),
    commit: (input) => legacy.commit(input),
    commitDraft: (input) => legacy.commitDraft(input),
    recover: (documentId) => legacy.recover(documentId),
    closeCleanly: (input) => legacy.closeCleanly(input),
    commitAuthority: (input) => repository.commitAuthority(input),
    commitAuthorityDraft: (input) => repository.commitAuthorityDraft(input),
    closeAuthorityCleanly: (input) => repository.closeAuthorityCleanly(input),
    recoverAuthority: (documentId) => {
      if (!first) return repository.recoverAuthority(documentId)
      first = false
      return recoverFirst()
    },
  }
}

function incompleteRecoveryLeases(source: DocumentLeasePort): DocumentLeasePort {
  return {
    acquire: async () => ({
      ok: false,
      diagnostic: {
        code: "write-access-unavailable",
        message: "The recovered document has missing history and is read-only.",
        retryable: false,
      },
    }),
    release: (input) => source.release(input),
  }
}

/** Normal opens keep V2 authority; only an absent versioned head enters legacy promotion. */
export async function openAuthorityDocumentSession(
  dependencies: AuthorityDocumentSessionDependencies,
  input: Parameters<typeof openVersionedDocumentSession>[1],
): Promise<PersistentDocumentSessionOpenResult> {
  const documentId = documentIdSchema.safeParse(input.documentId)
  const sessionId = sessionIdSchema.safeParse(input.sessionId)
  if (!documentId.success || !sessionId.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-session-input",
        message: "The authored document open request is invalid.",
        retryable: false,
        sourceCode: null,
      },
    }
  const repository = dependencies.versionedRepository
  const recovered = await repository.recoverAuthority(documentId.data)
  if (!recovered.ok) {
    if (recovered.diagnostic.code !== "document-not-found")
      return {
        ok: false,
        diagnostic: {
          code: "persistence-failed",
          message: "The authored document could not be recovered.",
          retryable: recovered.diagnostic.retryable,
          sourceCode: recovered.diagnostic.code,
        },
      }
    return openVersionedDocumentSession(
      {
        ...dependencies,
        createAdapter: (cachedLegacy, snapshot) =>
          createAuthorityPersistenceAdapter(
            cachedAuthorityRepository(
              repository,
              () => cachedLegacy.recover(documentId.data),
              cachedLegacy,
            ),
            dependencies.createPart,
            snapshot,
          ),
      },
      input,
    )
  }
  const complete =
    recovered.value.status !== "recovered-with-loss" && recovered.value.lostRevisionCount === 0
  const adapter = createAuthorityPersistenceAdapter(
    cachedAuthorityRepository(repository, async () => recovered),
    dependencies.createPart,
    recovered.value.snapshot,
  )
  return openPersistentDocumentSession(
    {
      ...dependencies,
      repository: adapter,
      leases: complete ? dependencies.leases : incompleteRecoveryLeases(dependencies.leases),
    },
    {
      documentId: documentId.data,
      sessionId: sessionId.data,
      mesh: input.mesh,
      ...(input.leaseDurationMs === undefined ? {} : { leaseDurationMs: input.leaseDurationMs }),
    },
  )
}
