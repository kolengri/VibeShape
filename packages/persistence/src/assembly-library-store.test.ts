import { describe, expect, it } from "bun:test"
import { meshImportOutputRole } from "@vibeshape/domain"
import { assemblyLibraryDefinitionSchema } from "@vibeshape/domain/assembly-library"
import {
  assemblyLibraryFixture,
  libraryFixtureId,
  libraryFixtureTimestamp,
} from "../../../scripts/assembly-library-fixture"
import { vi } from "../../../tests/unit/support/bun-test"
import { AssemblyLibraryDatabase, LocalAssemblyLibraryRepository } from "./assembly-library-store"

function input() {
  const f = assemblyLibraryFixture()
  return {
    itemId: libraryFixtureId(90),
    expectedMetadataRevision: null,
    name: "Reusable source",
    tags: [],
    definition: f.definition,
    blobs: [f.blob],
    createdAt: libraryFixtureTimestamp,
  }
}
function largeClosure() {
  const f = assemblyLibraryFixture()
  const pinned = f.definition.pinnedModels[0]
  const original = pinned?.snapshot.features[0]
  if (!pinned || !original) throw new Error("The fixture requires an imported producer.")
  const sources = Array.from({ length: 4 }, (_, n) => {
    const asset = {
      ...f.asset,
      id: libraryFixtureId(100 + n * 2),
      outputs: [libraryFixtureId(101 + n * 2)],
      digest: (n + 10).toString(16).repeat(64),
      byteLength: 20 * 1024 * 1024,
    }
    const feature = {
      ...original,
      id: libraryFixtureId(200 + n),
      parameters: {
        sourceAssetId: asset.id,
        source: {
          digest: asset.digest,
          byteLength: asset.byteLength,
          format: "stl",
          normalization: asset.normalization,
          parserPolicyVersion: 1,
        },
        outputs: [{ outputId: asset.outputs[0], nodeKey: "stl.mesh" }],
      },
    }
    return {
      source: {
        kind: "asset-output",
        assetId: asset.id,
        outputId: asset.outputs[0],
        digest: asset.digest,
      },
      pinned: {
        ...pinned,
        sourceIndex: n,
        selectedBody: {
          ...pinned.selectedBody,
          featureId: feature.id,
          outputRole: meshImportOutputRole(asset.outputs[0] ?? ""),
        },
        snapshot: {
          ...pinned.snapshot,
          features: [feature],
          history: [{ kind: "feature", id: feature.id }],
        },
        assets: [asset],
      },
    }
  })
  return assemblyLibraryDefinitionSchema.parse({
    ...f.definition,
    sources: sources.map(({ source }) => source),
    pinnedModels: sources.map(({ pinned }) => pinned),
  })
}

describe("library storage prepublication boundaries", () => {
  it("rejects invalid bytes and untrusted inputs before opening browser storage", async () => {
    const repository = new LocalAssemblyLibraryRepository(
      new AssemblyLibraryDatabase("library-preflight-unit"),
    )
    const request = input()
    expect(
      await repository.publishVersion({
        ...request,
        blobs: [{ ...request.blobs[0], bytes: new Uint8Array([1, 2, 4]) }],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
    expect(await repository.publishVersion({ ...request, unexpected: true })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-input" },
    })
    expect(await repository.listItems({ limit: 201 })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-input" },
    })
    expect(repository.database.isOpen()).toBe(false)
  })
  it("admits a valid source closure above 64 MiB to the storage transaction", async () => {
    const repository = new LocalAssemblyLibraryRepository(
      new AssemblyLibraryDatabase("library-budget-unit"),
    )
    const transaction = vi
      .spyOn(repository.database, "transaction")
      .mockRejectedValue(new Error("storage admission reached"))
    try {
      expect(
        await repository.publishVersion({ ...input(), definition: largeClosure(), blobs: [] }),
      ).toMatchObject({ ok: false, diagnostic: { code: "storage-unavailable" } })
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(repository.database.isOpen()).toBe(false)
    } finally {
      transaction.mockRestore()
    }
  })
})
