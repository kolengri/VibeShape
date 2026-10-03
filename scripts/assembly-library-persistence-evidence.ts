import { canonicalJson } from "../packages/domain/src/canonical-json"
import {
  AssemblyLibraryDatabase,
  LocalAssemblyLibraryRepository,
} from "../packages/persistence/src/assembly-library-store"
import type { PersistenceResult } from "../packages/persistence/src/repository"
import {
  assemblyLibraryFixture,
  libraryFixtureId,
  libraryFixtureTimestamp,
} from "./assembly-library-fixture"

function value<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
function requireEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
async function identity(database: AssemblyLibraryDatabase) {
  return canonicalJson({
    items: await database.items.toArray(),
    versions: await database.versions.toArray(),
    digests: (await database.blobs.toArray()).map(({ digest, bytes }) => ({
      digest,
      bytes: [...bytes],
    })),
  })
}
export async function runAssemblyLibraryPersistenceEvidence(
  name: string,
  createFutureDatabase: (name: string) => Promise<void>,
) {
  const fixture = assemblyLibraryFixture()
  let database = new AssemblyLibraryDatabase(name)
  let repository = new LocalAssemblyLibraryRepository(database)
  const input = {
    itemId: libraryFixtureId(90),
    expectedMetadataRevision: null,
    name: "Reusable bracket",
    tags: ["Print", "Fixtures"],
    definition: fixture.definition,
    blobs: [fixture.blob],
    createdAt: libraryFixtureTimestamp,
  }
  const peer = new AssemblyLibraryDatabase(name)
  try {
    const first = value(await repository.publishVersion(input))
    requireEvidence(
      first.item.headVersion === 1 && first.item.metadataRevision === 1,
      "The first library revision must publish its head.",
    )
    fixture.blob.bytes.fill(0)
    first.blobs[0]?.bytes.fill(0)
    requireEvidence(
      value(await repository.readVersion({ itemId: input.itemId })).blobs[0]?.bytes[0] === 1,
      "Published source bytes must own their buffers.",
    )
    value(
      await repository.updateMetadata({
        itemId: input.itemId,
        expectedMetadataRevision: 1,
        name: "Named bracket",
        tags: ["Print", "Reusable"],
        updatedAt: libraryFixtureTimestamp,
      }),
    )
    requireEvidence(
      value(await repository.listItems({ query: "named PRINT" })).length === 1,
      "Name and tag search must be case insensitive and conjunctive.",
    )
    requireEvidence(
      value(await repository.listItems({ query: "unknown" })).length === 0,
      "Unmatched search must remain empty.",
    )
    const newer = {
      ...fixture.definition,
      name: "Frozen source revision two",
      sourceFrame: { translation: [5, 0, 0], quaternion: [0, 0, 0, 1] },
    }
    const second = value(
      await repository.publishVersion({
        ...input,
        expectedMetadataRevision: 2,
        definition: newer,
        blobs: [],
      }),
    )
    requireEvidence(
      second.version.version === 2 && second.item.metadataRevision === 3,
      "Version and optimistic metadata revisions must advance separately.",
    )
    const old = value(await repository.readVersion({ itemId: input.itemId, version: 1 }))
    requireEvidence(
      old.version.definition.name === "Frozen source" &&
        old.version.contentDigest === first.version.contentDigest,
      "Old frozen revisions must remain immutable.",
    )
    database.close()
    database = new AssemblyLibraryDatabase(name)
    repository = new LocalAssemblyLibraryRepository(database)
    requireEvidence(
      value(await repository.readVersion({ itemId: input.itemId })).version.version === 2,
      "Reopening must recover the versioned library head.",
    )
    const peerRepository = new LocalAssemblyLibraryRepository(peer)
    const concurrent = await Promise.all([
      repository.updateMetadata({
        itemId: input.itemId,
        expectedMetadataRevision: 3,
        name: "First writer",
        tags: [],
        updatedAt: libraryFixtureTimestamp,
      }),
      peerRepository.updateMetadata({
        itemId: input.itemId,
        expectedMetadataRevision: 3,
        name: "Second writer",
        tags: [],
        updatedAt: libraryFixtureTimestamp,
      }),
    ])
    requireEvidence(
      concurrent.filter(({ ok }) => ok).length === 1 &&
        concurrent.some((result) => !result.ok && result.diagnostic.code === "stale-revision"),
      "Only one optimistic concurrent write may succeed.",
    )
    const stable = await identity(database)
    const corrupt = await repository.publishVersion({
      ...input,
      itemId: libraryFixtureId(91),
      blobs: [{ ...fixture.blob, bytes: new Uint8Array([1, 2, 4]) }],
    })
    requireEvidence(
      !corrupt.ok &&
        corrupt.diagnostic.code === "invalid-input" &&
        (await identity(database)) === stable,
      "Invalid byte hashes must fail before publication.",
    )
    const missing = await repository.publishVersion({
      ...input,
      itemId: libraryFixtureId(91),
      definition: fixture.definition,
      blobs: [{ digest: "a".repeat(64), bytes: new Uint8Array([1]) }],
    })
    requireEvidence(
      !missing.ok && (await identity(database)) === stable,
      "Extraneous byte closure must reject without partial records.",
    )
    await database.blobs.delete(fixture.asset.digest)
    const withoutBytes = await identity(database)
    const missingRead = await repository.readVersion({ itemId: input.itemId })
    const missingWrite = await repository.publishVersion({
      ...input,
      itemId: libraryFixtureId(91),
      blobs: [],
    })
    requireEvidence(
      !missingRead.ok &&
        missingRead.diagnostic.code === "corrupt-history" &&
        !missingWrite.ok &&
        (await identity(database)) === withoutBytes,
      "Missing required bytes must reject read and write atomically.",
    )
    const beforeQuota = await identity(database)
    const quota = () => {
      throw new DOMException("Injected library storage quota", "QuotaExceededError")
    }
    database.items.hook("creating", quota)
    const quotaWrite = await repository.publishVersion({
      ...input,
      itemId: libraryFixtureId(91),
      blobs: [{ digest: fixture.asset.digest, bytes: new Uint8Array([1, 2, 3]) }],
    })
    database.items.hook("creating").unsubscribe(quota)
    requireEvidence(
      !quotaWrite.ok &&
        quotaWrite.diagnostic.code === "quota-exceeded" &&
        (await identity(database)) === beforeQuota,
      "Quota failure after version insertion must roll back all stores.",
    )
    await database.blobs.add({ digest: fixture.asset.digest, bytes: new Uint8Array([1, 2, 3]) })
    await database.versions.put({ ...first.version, contentDigest: "a".repeat(64) })
    const badVersion = await repository.readVersion({ itemId: input.itemId, version: 1 })
    requireEvidence(
      !badVersion.ok && badVersion.diagnostic.code === "corrupt-history",
      "Frozen revision checksum corruption must be rejected.",
    )
    await database.versions.put(first.version)
    await database.blobs.put({ digest: fixture.asset.digest, bytes: new Uint8Array([9, 9, 9]) })
    const badBytes = await repository.readVersion({ itemId: input.itemId })
    requireEvidence(
      !badBytes.ok && badBytes.diagnostic.code === "corrupt-history",
      "Stored source byte corruption must be rejected on read.",
    )
    await createFutureDatabase(`${name}-future`)
    const oldRuntime = new AssemblyLibraryDatabase(`${name}-future`)
    const unsupported = await new LocalAssemblyLibraryRepository(oldRuntime).listItems()
    oldRuntime.close()
    requireEvidence(
      !unsupported.ok && unsupported.diagnostic.code === "unsupported-version",
      `A future library database version must not fall back to older authority: ${JSON.stringify(unsupported)}.`,
    )
    return {
      publication: true,
      immutableVersions: true,
      restarted: true,
      concurrentStaleRejected: true,
      quotaRollback: true,
      byteClosureRejected: true,
      corruptionRejected: true,
      futureVersionRejected: true,
      search: true,
    }
  } finally {
    database.close()
    peer.close()
    await database.delete()
    await new AssemblyLibraryDatabase(`${name}-future`).delete()
  }
}
