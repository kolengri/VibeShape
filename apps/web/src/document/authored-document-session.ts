import type { PartAllocationFactory } from "@vibeshape/application/authority-persistence-operations"
import type { PersistentDocumentSessionOpenResult } from "@vibeshape/application/persistent-document-session"
import { generateUuidV7, partIdSchema } from "@vibeshape/domain/identifiers"

export function browserAuthoredUuid() {
  return generateUuidV7({
    timestampMs: Date.now(),
    randomBytes: crypto.getRandomValues(new Uint8Array(10)),
  })
}

export const createBrowserPart: PartAllocationFactory = (requirement, feature, ordinal) => ({
  id: partIdSchema.parse(browserAuthoredUuid()),
  body: requirement.body,
  origin: requirement.origin,
  name: feature?.label ?? `Part ${ordinal}`,
})

/** Upgrade only a leased, fully recovered session; the immutable prior journal is retained. */
export async function enableAuthoredDocument(
  opened: PersistentDocumentSessionOpenResult,
): Promise<PersistentDocumentSessionOpenResult> {
  if (
    !opened.ok ||
    opened.session.mode !== "read-write" ||
    opened.session.authoredSnapshot?.schemaVersion === 2
  )
    return opened
  const result = await opened.session.commitAuthored({
    kind: "org.vibeshape.document.upgrade-v2",
    schemaVersion: 2,
    commandId: browserAuthoredUuid(),
    documentId: opened.session.snapshot.id,
    baseRevision: opened.session.snapshot.revision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: {},
  })
  if (!result.ok) {
    await opened.session.close()
    return result
  }
  return {
    ...opened,
    report: {
      ...opened.report,
      snapshot: result.snapshot,
      historyItems: opened.session.historyItems,
      rebuild: result.rebuild,
    },
  }
}
