import { requireAuthorityProject, requireSupportedAuthorityVersion } from "./authority-records"
import { authorityCleanCloseInputSchema } from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import type { PersistenceResult } from "./repository"
import { requireWriterLease } from "./writer-lease-authority"

export async function closeDocumentAuthority(
  database: VibeShapeDatabase,
  inputValue: unknown,
): Promise<PersistenceResult<void>> {
  const input = authorityCleanCloseInputSchema.safeParse(inputValue)
  if (!input.success)
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic(
        "invalid-input",
        "The authority clean-close input is invalid.",
      ),
    }
  try {
    await database.transaction(
      "rw",
      database.projectsV1,
      database.recoveryV1,
      database.leases,
      async () => {
        const project = await requireAuthorityProject(database, input.data.documentId)
        if (project.headRevision !== input.data.revision)
          throw persistenceInvariantError(
            "stale-revision",
            "The authority clean-close revision is stale.",
          )
        requireWriterLease(true, await database.leases.get(input.data.documentId), input.data)
        requireSupportedAuthorityVersion(await database.recoveryV1.get(input.data.documentId))
        await database.projectsV1.put({ ...project, cleanCloseRevision: input.data.revision })
        await database.recoveryV1.delete(input.data.documentId)
      },
    )
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}
