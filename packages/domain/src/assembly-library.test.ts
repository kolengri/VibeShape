import { describe, expect, it } from "vitest"
import {
  assemblyLibraryFixture,
  libraryFixtureId,
  libraryFixtureTimestamp,
} from "../../../scripts/assembly-library-fixture"
import {
  assemblyLibraryBindingSchema,
  assemblyLibraryDefinitionAssets,
  assemblyLibraryDefinitionSchema,
  assemblyLibraryItemSchema,
  assemblyLibraryVersionSchema,
} from "./assembly-library"

describe("immutable assembly library schemas", () => {
  it("accepts a complete frozen definition and derives an exact deduplicated source closure", () => {
    const { definition, asset } = assemblyLibraryFixture()
    const duplicated = {
      ...definition,
      sources: [
        ...definition.sources,
        {
          kind: "part",
          partId: libraryFixtureId(30),
          body: definition.pinnedModels[0]?.selectedBody,
          contentHash: "a".repeat(64),
        },
      ],
      pinnedModels: [definition.pinnedModels[0], { ...definition.pinnedModels[0], sourceIndex: 1 }],
    }
    expect(assemblyLibraryDefinitionSchema.safeParse(definition).success).toBe(true)
    expect(
      assemblyLibraryDefinitionAssets(assemblyLibraryDefinitionSchema.parse(duplicated)),
    ).toEqual([asset])
    expect(
      assemblyLibraryBindingSchema.parse({ itemId: libraryFixtureId(90), version: 1 }),
    ).toEqual({ itemId: libraryFixtureId(90), version: 1 })
  })
  it("rejects incomplete, changed, reordered or extraneous pinned semantic content", () => {
    const { definition, asset } = assemblyLibraryFixture()
    const pinned = definition.pinnedModels[0]
    if (!pinned) throw new Error("The fixture requires one source.")
    for (const invalid of [
      { ...definition, pinnedModels: [] },
      {
        ...definition,
        pinnedModels: [
          { ...pinned, selectedBody: { ...pinned.selectedBody, outputRole: "result" } },
        ],
      },
      {
        ...definition,
        pinnedModels: [{ ...pinned, assets: [{ ...asset, digest: "a".repeat(64) }] }],
      },
      {
        ...definition,
        pinnedModels: [{ ...pinned, snapshot: { ...pinned.snapshot, history: [] } }],
      },
      { ...definition, pinnedModels: [{ ...pinned, sourceIndex: 1 }] },
    ])
      expect(assemblyLibraryDefinitionSchema.safeParse(invalid).success).toBe(false)
  })
  it("bounds versions, tags and untrusted records without a compatibility catch-all", () => {
    const { definition } = assemblyLibraryFixture()
    const item = {
      schemaVersion: 1,
      id: libraryFixtureId(90),
      metadataRevision: 1,
      headVersion: 1,
      name: "Reusable mesh",
      tags: ["Bracket", "Print"],
      createdAt: libraryFixtureTimestamp,
      updatedAt: libraryFixtureTimestamp,
    }
    expect(assemblyLibraryItemSchema.safeParse(item).success).toBe(true)
    expect(assemblyLibraryItemSchema.safeParse({ ...item, tags: ["Print", "print"] }).success).toBe(
      false,
    )
    expect(assemblyLibraryItemSchema.safeParse({ ...item, headVersion: 1025 }).success).toBe(false)
    expect(assemblyLibraryItemSchema.safeParse({ ...item, unexpected: true }).success).toBe(false)
    expect(
      assemblyLibraryVersionSchema.safeParse({
        schemaVersion: 1,
        itemId: item.id,
        version: 1,
        createdAt: libraryFixtureTimestamp,
        definition,
        contentDigest: "a".repeat(64),
      }).success,
    ).toBe(true)
    expect(assemblyLibraryBindingSchema.safeParse({ itemId: item.id, version: 0 }).success).toBe(
      false,
    )
  })
})
