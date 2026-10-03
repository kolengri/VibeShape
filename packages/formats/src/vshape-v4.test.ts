import { applyDocumentV3Command } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  surfaceTextureProjectFixture,
  textureFixtureEnvelope,
  textureSuccess,
} from "../../../tests/fixtures/surface-texture-project"
import { readAuthoredVShape, readVShapeV3, readVShapeV4, writeVShapeV4 } from "./vshape"

function project() {
  const fixture = surfaceTextureProjectFixture()
  const layer = {
    ...fixture.layer,
    map: {
      kind: "custom",
      width: 256,
      height: 256,
      pixels: Array.from({ length: 65_536 }, () => 0),
    },
    mask: {
      base: "empty",
      strokes: [
        { center: [2, 3, 40], normal: [0, 0, 1], radiusMm: 3, hardness: 0.7, mode: "paint" },
      ],
    },
  }
  const applied = textureSuccess(
    applyDocumentV3Command(fixture.snapshot, {
      ...textureFixtureEnvelope(3),
      schemaVersion: 3,
      kind: "org.vibeshape.document.metadata-command",
      payload: { kind: "textures.replace-layers", featureId: layer.featureId, layers: [layer] },
    }),
  )
  return {
    ...fixture.portable,
    snapshot: applied.snapshot,
    textureUpgradeRevision: 4,
    versionedEvents: [...fixture.events, applied.event],
  }
}

describe("surface texture V4 native archives", () => {
  it("round-trips legal highly compressible grayscale maps, masks and complete mixed history", async () => {
    const input = project()
    const written = textureSuccess(await writeVShapeV4(input))
    const read = textureSuccess(await readVShapeV4(written.value))
    expect(read.value.snapshot).toEqual(input.snapshot)
    expect(read.value.versionedEvents).toEqual(input.versionedEvents)
    expect(textureSuccess(await readAuthoredVShape(written.value)).value.version).toBe(4)
    expect((await readVShapeV3(written.value)).ok).toBe(false)
  })

  it("rejects unjournaled layers and mismatched texture adoption provenance", async () => {
    const input = project()
    expect(await writeVShapeV4({ ...input, textureUpgradeRevision: 3 })).toMatchObject({
      ok: false,
    })
    expect(
      await writeVShapeV4({ ...input, snapshot: { ...input.snapshot, surfaceTextures: [] } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "history-mismatch" } })
  })

  it("retains checkpoint evidence while refusing malformed archives", async () => {
    const input = project()
    const checkpoint = textureSuccess(
      await writeVShapeV4({
        ...input,
        seed: input.snapshot,
        versionedEvents: [],
        historyMode: "checkpoint",
        promotionRevision: input.snapshot.revision,
        migrationDiagnostic: {
          code: "legacy-journal-unavailable",
          message: "The original journal is unavailable.",
        },
        unavailableRecords: ["authority-history"],
      }),
    )
    expect(textureSuccess(await readVShapeV4(checkpoint.value)).value.manifest.historyMode).toBe(
      "checkpoint",
    )
    expect((await readVShapeV4(checkpoint.value.subarray(0, 30))).ok).toBe(false)
  })
})
