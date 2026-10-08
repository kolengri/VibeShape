import { describe, expect, it } from "bun:test"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { applyHistoryRemoveRetainingDependentsCommand } from "@vibeshape/domain/document-v5-commands"
import { importedBodyOutputRole, importedFeatureType } from "@vibeshape/domain/part-design-import"
import { sourceAssetSchema } from "@vibeshape/domain/source-assets"
import { VibeShapeDatabase } from "@vibeshape/persistence"
import {
  historyRepairFixture,
  repairId,
  repairRemovalCommand,
} from "../../../../packages/domain/src/history-repair.test-fixture"
import { assemblyLibraryFixture } from "../../../../scripts/assembly-library-fixture"
import { vi } from "../../../../tests/unit/support/bun-test"
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
  it("materializes independent STEP assets after deletion adopts V5 repair authority", async () => {
    const imported = assemblyLibraryFixture()
    const asset = sourceAssetSchema.parse({
      ...imported.asset,
      filename: "Independent.step",
      format: "step",
      representation: "exact-solid",
    })
    const fixture = historyRepairFixture()
    const feature = {
      schemaVersion: 1,
      id: repairId(60),
      type: importedFeatureType.type,
      label: "Independent STEP",
      dependencies: [],
      references: [],
      semanticInputs: [],
      suppressed: false,
      parameters: {
        sourceAssetId: asset.id,
        source: {
          digest: asset.digest,
          byteLength: asset.byteLength,
          format: asset.format,
          normalization: asset.normalization,
          unitPolicy: "step-system-mm",
          readerPolicyVersion: 1,
        },
        outputs: asset.outputs.map((outputId) => ({
          outputId,
          signature: {
            volume: 24,
            area: 52,
            centroid: [1, 1.5, 2],
            bounds: { min: [0, 0, 0], max: [2, 3, 4] },
            faceCount: 6,
            edgeCount: 24,
          },
        })),
        matchingPolicyVersion: 1,
      },
    }
    const authority = documentSnapshotV4Schema.parse({
      ...fixture,
      schemaVersion: 4,
      surfaceTextures: [],
      assets: [asset],
      assembly: imported.document.assembly,
      features: [...fixture.features, feature],
      history: [...fixture.history, { kind: "feature", id: feature.id }],
      parts: [
        ...fixture.parts,
        {
          schemaVersion: 0,
          id: repairId(102),
          name: "Independent STEP",
          visible: true,
          origin: "independent",
          consumedBy: null,
          bodyHistory: [
            {
              schemaVersion: 0,
              featureId: feature.id,
              outputRole: importedBodyOutputRole(asset.outputs[0] ?? ""),
            },
          ],
        },
      ],
    })
    const removed = applyHistoryRemoveRetainingDependentsCommand(
      authority,
      repairRemovalCommand(authority.revision),
    )
    if (!removed.ok) throw new Error(removed.diagnostic.message)
    expect(removed.snapshot.repairIntents).toHaveLength(3)
    const database = new VibeShapeDatabase("v5-independent-step-materialization")
    vi.spyOn(database.assetBlobs, "get").mockResolvedValue(imported.blob)
    try {
      const result = await materializeDocumentSourceAssets(
        database,
        async () => removed.snapshot,
        removed.snapshot.features,
      )
      expect(result).toHaveLength(1)
      expect(result[0]?.asset).toEqual(asset)
      expect([...(result[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    } finally {
      database.close()
    }
  })

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
