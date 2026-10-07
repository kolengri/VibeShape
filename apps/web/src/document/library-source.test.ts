import { documentSnapshotV5Schema } from "@vibeshape/domain/document-v5"
import { describe, expect, it, vi } from "vitest"
import { assemblyLibraryFixture } from "../../../../scripts/assembly-library-fixture"
import * as assemblyModel from "../features/assembly/assembly-model"
import type { DocumentControllerState } from "./document-controller"
import { captureLibrarySource } from "./library-source"

describe("V5 library source capture", () => {
  it("retains immutable imported assets in a frozen definition from an independent V5 Part", () => {
    const fixture = assemblyLibraryFixture()
    const authority = documentSnapshotV5Schema.parse({
      ...fixture.document,
      schemaVersion: 5,
      repairIntents: [],
      suspendedParts: [],
    })
    const part = authority.parts[0]
    const body = part?.bodyHistory[0]
    if (!part || !body) throw new Error("Missing independent import fixture.")
    const sources = vi.spyOn(assemblyModel, "assemblyPartSources").mockReturnValue([
      {
        name: part.name,
        source: { kind: "part", partId: part.id, body, contentHash: "a".repeat(64) },
      },
    ])
    try {
      const controller: DocumentControllerState = {
        status: "ready",
        saveStatus: "saved",
        diagnostic: null,
        report: null,
        authoredSnapshot: authority,
      }
      const definition = captureLibrarySource(controller, {
        source: { kind: "part", id: part.id },
        name: "Frozen independent import",
      })
      expect(definition.pinnedModels[0]?.assets).toEqual([fixture.asset])
      expect(definition.pinnedModels[0]?.selectedBody).toEqual(body)
      expect(authority.assets).toEqual([fixture.asset])
    } finally {
      sources.mockRestore()
    }
  })
})
