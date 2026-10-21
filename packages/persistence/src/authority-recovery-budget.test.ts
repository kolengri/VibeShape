import { expect, it } from "bun:test"
import { applyVersionedDocumentCommand } from "@vibeshape/domain"
import { storeAuthoritySnapshot } from "./authority-records"
import { loadAuthorityRestoreTarget, recoverAuthoritySnapshot } from "./authority-recovery"
import type { VibeShapeDatabase } from "./database"
import { classifyPersistenceError } from "./diagnostics"
import { projectRecordV1Schema } from "./schemas"

const at = "2026-10-21T00:00:00Z"
const created = applyVersionedDocumentCommand(null, {
  schemaVersion: 1,
  kind: "org.vibeshape.document.create",
  documentId: "0195b5ac-b250-7a2c-8c33-000000000001",
  commandId: "0195b5ac-b250-7a2c-8c33-000000000002",
  baseRevision: 0,
  issuedAt: at,
  actor: { type: "user", userId: null },
  payload: { name: "Snapshot scan" },
})
if (!created.ok) throw new Error(created.diagnostic.message)
const first = created.snapshot

async function scanFixture(direction: "backward" | "forward", invalidRows: number) {
  const headRevision = invalidRows + 1
  const snapshot = { ...first, revision: direction === "backward" ? 1 : headRevision }
  const valid = await storeAuthoritySnapshot(snapshot, at)
  const project = projectRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: first.id,
    name: first.name,
    headRevision,
    latestSnapshotRevision: headRevision,
    cleanCloseRevision: null,
    createdAt: at,
    updatedAt: at,
    lastExternalBackupAt: null,
    migrationProvenance: "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
  })
  let lookups = 0
  const database = {
    eventsV1: { async get() {} },
    snapshotsV1: {
      async get() {},
      where() {
        return {
          between(start: [string, number], end: [string, number]) {
            let descending = false
            const collection = {
              reverse() {
                descending = true
                return collection
              },
              async first() {
                lookups++
                const revision = descending ? end[1] : Math.max(1, start[1])
                if (revision < 1 || revision > headRevision) return undefined
                if (revision === valid.revision) return valid
                return {
                  ...valid,
                  revision,
                  // Budget tests avoid 100,000 cryptographic operations; small scans
                  // below exercise checksum mismatches through the same fallback loop.
                  checksum: invalidRows > 10 ? "invalid" : "0".repeat(64),
                }
              },
            }
            return collection
          },
        }
      },
    },
  } as unknown as VibeShapeDatabase
  const load = () =>
    direction === "backward"
      ? recoverAuthoritySnapshot(database, project).then((result) => result.snapshot)
      : loadAuthorityRestoreTarget(database, first.id, headRevision)
  return { load, snapshot, lookups: () => lookups }
}

it.each(["backward", "forward"] as const)(
  "bounds malformed snapshot rows during %s recovery scans",
  async (direction) => {
    const fixture = await scanFixture(direction, 100_001)
    const diagnostic = await fixture.load().then(() => null, classifyPersistenceError)
    expect(diagnostic).toMatchObject({ code: "corrupt-history" })
    expect(fixture.lookups()).toBe(100_001)
  },
  60000,
)

it.each(["backward", "forward"] as const)(
  "accepts a valid checkpoint at the snapshot-record budget in a %s scan",
  async (direction) => {
    const fixture = await scanFixture(direction, 99_999)
    expect(await fixture.load()).toEqual(fixture.snapshot)
    expect(fixture.lookups()).toBe(100_000)
  },
  60000,
)

it.each(["backward", "forward"] as const)(
  "retains a valid checkpoint after checksum-invalid rows in a %s scan",
  async (direction) => {
    const fixture = await scanFixture(direction, 2)
    expect(await fixture.load()).toEqual(fixture.snapshot)
    expect(fixture.lookups()).toBe(3)
  },
)
