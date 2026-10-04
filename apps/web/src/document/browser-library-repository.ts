import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type AssemblyLibraryPort,
  ownedLibraryVersionSchema,
} from "@vibeshape/automation-host/assembly-session-contract"
import {
  AssemblyLibraryDatabase,
  LocalAssemblyLibraryRepository,
} from "@vibeshape/persistence/assembly-library-store"

let repository: LocalAssemblyLibraryRepository | undefined
export function localLibrary() {
  repository ??= new LocalAssemblyLibraryRepository(new AssemblyLibraryDatabase())
  return repository
}

function publicationGuard(checkAuthority: () => LocalFailure | null) {
  let interrupted: LocalFailure | null = null
  return {
    assertWritable() {
      interrupted = checkAuthority()
      if (interrupted) throw new Error(interrupted.diagnostic.message)
    },
    failure: () => interrupted,
  }
}
/** The paired controller owns library closure lookup; protocol callers never supply frozen bytes. */
export function createAutomationLibraryPort(
  prepareSource: AssemblyLibraryPort["prepareSource"],
): AssemblyLibraryPort {
  const diagnostic = (value: { code: string; message: string; retryable: boolean }) =>
    localFailure(value.code, value.message.slice(0, 512), value.retryable)
  return {
    async list(input) {
      const result = await localLibrary().listItems(input)
      return result.ok ? result : diagnostic(result.diagnostic)
    },
    async read(input) {
      const result = await localLibrary().readVersion(input)
      return result.ok
        ? { ok: true, value: ownedLibraryVersionSchema.parse(result.value) }
        : diagnostic(result.diagnostic)
    },
    prepareSource,
    async publish(input, checkAuthority) {
      const guard = publicationGuard(checkAuthority)
      const result = await localLibrary().publishVersion(input, guard.assertWritable)
      const interrupted = guard.failure()
      if (interrupted) return interrupted
      return result.ok
        ? { ok: true, value: ownedLibraryVersionSchema.parse(result.value) }
        : diagnostic(result.diagnostic)
    },
    async updateMetadata(input, checkAuthority) {
      const guard = publicationGuard(checkAuthority)
      const result = await localLibrary().updateMetadata(input, guard.assertWritable)
      const interrupted = guard.failure()
      if (interrupted) return interrupted
      return result.ok ? result : diagnostic(result.diagnostic)
    },
  }
}
