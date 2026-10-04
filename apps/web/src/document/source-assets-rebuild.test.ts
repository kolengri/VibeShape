// @vitest-environment node

import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { VibeShapeDatabase } from "@vibeshape/persistence"
import { describe, expect, it, vi } from "vitest"
import { assemblyLibraryFixture } from "../../../../scripts/assembly-library-fixture"
import { BrowserProjectRepository } from "./browser-project-repository"
import {
  materializeAssemblySourceAssets,
  materializeDocumentSourceAssets,
} from "./source-assets-rebuild"

describe("owned disposable assembly source bytes", () => {
  it("verifies and copies library closure bytes without publishing or reading project blobs", async () => {
    const fixture = assemblyLibraryFixture()
    const authority = documentSnapshotV4Schema.parse({
      ...fixture.document,
      assembly: { ...fixture.document.assembly, definitions: [fixture.definition] },
    })
    const database = new VibeShapeDatabase("owned-assembly-materialization")
    const read = vi.spyOn(database.assetBlobs, "get")
    const publish = vi.spyOn(database.assetBlobs, "put")
    const result = await materializeAssemblySourceAssets(database, authority, [fixture.blob])
    expect(result).toHaveLength(1)
    expect(result[0]?.asset.digest).toBe(fixture.asset.digest)
    fixture.blob.bytes.fill(0)
    expect([...(result[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    expect(read).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    database.close()
  })
  it("rejects corrupt or unrelated owned bytes before exposing materialized geometry", async () => {
    const fixture = assemblyLibraryFixture()
    const authority = documentSnapshotV4Schema.parse({
      ...fixture.document,
      assembly: { ...fixture.document.assembly, definitions: [fixture.definition] },
    })
    const database = new VibeShapeDatabase("invalid-assembly-materialization")
    await expect(
      materializeAssemblySourceAssets(database, authority, [
        { ...fixture.blob, bytes: new Uint8Array([4, 5, 6]) },
      ]),
    ).rejects.toThrow()
    const empty = documentSnapshotV4Schema.parse({
      ...fixture.document,
      assembly: fixture.document.assembly,
    })
    await expect(materializeAssemblySourceAssets(database, empty, [fixture.blob])).rejects.toThrow(
      "frozen assembly closure",
    )
    database.close()
  })
})

describe("owned history source descriptors", () => {
  it("reads captured checkpoint blobs after current authority has lost the imported descriptor", async () => {
    const fixture = assemblyLibraryFixture()
    const current = documentSnapshotV4Schema.parse({
      ...fixture.document,
      revision: 4,
      assets: [],
      features: [],
      history: [],
      parts: [],
    })
    const database = new VibeShapeDatabase("history-source-materialization")
    const read = vi.spyOn(database.assetBlobs, "get").mockResolvedValue(fixture.blob)
    const publish = vi.spyOn(database.assetBlobs, "put")
    const repository = new BrowserProjectRepository(database)
    const recover = vi.spyOn(repository.versioned, "recoverAuthority")
    try {
      await expect(
        materializeDocumentSourceAssets(database, async () => current, fixture.document.features),
      ).rejects.toThrow("source descriptor is missing")
      expect(read).not.toHaveBeenCalled()
      const result = await repository.materializeCapturedSourceAssets(fixture.document)
      expect(result).toHaveLength(1)
      expect(result[0]?.asset).toEqual(fixture.asset)
      expect([...(result[0]?.bytes ?? [])]).toEqual([1, 2, 3])
      expect(read).toHaveBeenCalledWith(fixture.asset.digest)
      fixture.blob.bytes.fill(0)
      expect([...(result[0]?.bytes ?? [])]).toEqual([1, 2, 3])
      expect(recover).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(current.assets).toEqual([])
    } finally {
      database.close()
    }
  })
})
