import { describe, expect, it } from "vitest"
import {
  surfaceTextureProjectFixture,
  textureFixtureEnvelope,
  textureFixtureId,
  textureSuccess,
} from "../../../tests/fixtures/surface-texture-project"
import { canonicalJson } from "./canonical-json"
import {
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  projectAuthoredDocumentSnapshotToV1,
} from "./document-v2"
import { documentV2EventSchema } from "./document-v2-command-schemas"
import { applyDocumentV2Command } from "./document-v2-commands"
import { copyCompleteDocumentAuthorityHistory } from "./document-v2-copy"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { applyDocumentV3Command, reduceDocumentV3Event } from "./document-v3-commands"
import { surfaceTextureLayerSchema, surfaceTextureLayersSchema } from "./surface-textures"

function applyFixture() {
  const fixture = surfaceTextureProjectFixture()
  const applied = textureSuccess(
    applyDocumentV3Command(fixture.snapshot, {
      ...textureFixtureEnvelope(3),
      schemaVersion: 3,
      kind: "org.vibeshape.document.metadata-command",
      payload: {
        kind: "textures.replace-layers",
        featureId: fixture.layer.featureId,
        layers: [fixture.layer],
      },
    }),
  )
  return { ...fixture, applied }
}

describe("authored surface texture authority", () => {
  it("upgrades and replaces layers in one revision without changing source model intent", () => {
    const { snapshot, layer, events, applied } = applyFixture()
    expect(applied.snapshot.revision).toBe(snapshot.revision + 1)
    expect(applied.event.type).toBe("org.vibeshape.document.upgraded-v3")
    expect(applied.snapshot.surfaceTextures).toEqual([layer])
    expect(projectAuthoredDocumentSnapshotToV1(applied.snapshot).features).toEqual(
      snapshot.features,
    )
    expect(applied.snapshot.parts).toEqual(snapshot.parts)
    expect(
      textureSuccess(replayDocumentAuthorityEvents(null, [...events, applied.event])).snapshot,
    ).toEqual(applied.snapshot)
    expect(documentSnapshotV2Schema.safeParse(applied.snapshot).success).toBe(false)
    expect(documentV2EventSchema.safeParse(applied.event).success).toBe(false)
  })

  it("restores first Apply with one undo and redo while retaining newest authority", () => {
    const { snapshot, layer, events, applied } = applyFixture()
    const undoEvent = {
      ...textureFixtureEnvelope(4),
      schemaVersion: 3,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 5,
      direction: "undo",
      targetRevision: snapshot.revision,
    }
    const undone = textureSuccess(reduceDocumentV3Event(applied.snapshot, undoEvent, snapshot))
    expect(undone.snapshot.schemaVersion).toBe(3)
    expect(undone.snapshot.surfaceTextures).toEqual([])
    expect(undone.snapshot.features).toEqual(snapshot.features)
    const redoEvent = {
      ...textureFixtureEnvelope(5),
      schemaVersion: 3,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 6,
      direction: "redo",
      targetRevision: applied.snapshot.revision,
    }
    const redone = textureSuccess(
      reduceDocumentV3Event(undone.snapshot, redoEvent, applied.snapshot),
    )
    expect(redone.snapshot.surfaceTextures).toEqual([layer])
    expect(
      textureSuccess(
        replayDocumentAuthorityEvents(null, [...events, applied.event, undoEvent, redoEvent]),
      ).snapshot,
    ).toEqual(redone.snapshot)
  })

  it("rejects stale, cross-feature, duplicate, no-op and over-budget changes", () => {
    const { layer, applied } = applyFixture()
    const command = {
      ...textureFixtureEnvelope(4),
      schemaVersion: 3,
      kind: "org.vibeshape.document.metadata-command",
      payload: { kind: "textures.replace-layers", featureId: layer.featureId, layers: [layer] },
    }
    expect(applyDocumentV3Command(applied.snapshot, { ...command, baseRevision: 3 })).toMatchObject(
      { ok: false, diagnostic: { code: "stale-revision" } },
    )
    expect(applyDocumentV3Command(applied.snapshot, command)).toMatchObject({
      ok: false,
      diagnostic: { code: "command-no-op" },
    })
    expect(
      applyDocumentV3Command(applied.snapshot, {
        ...command,
        payload: { ...command.payload, featureId: textureFixtureId(201) },
      }).ok,
    ).toBe(false)
    expect(surfaceTextureLayersSchema.safeParse([layer, layer]).success).toBe(false)
    expect(
      surfaceTextureLayersSchema.safeParse(
        Array.from({ length: 5 }, (_, index) => ({ ...layer, id: textureFixtureId(401 + index) })),
      ).success,
    ).toBe(false)
    expect(
      documentSnapshotV3Schema.safeParse({
        ...applied.snapshot,
        surfaceTextures: [{ ...layer, featureId: textureFixtureId(201) }],
      }).success,
    ).toBe(false)
    expect(applyDocumentV2Command(applied.snapshot, { ...command, schemaVersion: 2 }).ok).toBe(
      false,
    )
  })

  it("validates grayscale dimensions and brush limits at the persisted boundary", () => {
    const { layer } = surfaceTextureProjectFixture()
    expect(
      surfaceTextureLayerSchema.safeParse({
        ...layer,
        map: { kind: "custom", width: 2, height: 2, pixels: [0, 127, 200, 255] },
      }).success,
    ).toBe(true)
    for (const map of [
      { kind: "custom", width: 257, height: 1, pixels: [0] },
      { kind: "custom", width: 2, height: 2, pixels: [0] },
      { kind: "custom", width: 1, height: 1, pixels: [256] },
    ])
      expect(surfaceTextureLayerSchema.safeParse({ ...layer, map }).success).toBe(false)
    const stroke = {
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radiusMm: 2,
      hardness: 0.5,
      mode: "paint",
    }
    expect(
      surfaceTextureLayerSchema.safeParse({ ...layer, mask: { base: "empty", strokes: [stroke] } })
        .success,
    ).toBe(true)
    expect(
      surfaceTextureLayerSchema.safeParse({
        ...layer,
        mask: { base: "empty", strokes: [{ ...stroke, normal: [0, 0, 0] }] },
      }).success,
    ).toBe(false)
    expect(
      surfaceTextureLayerSchema.safeParse({
        ...layer,
        mask: { base: "empty", strokes: Array.from({ length: 2_049 }, () => stroke) },
      }).success,
    ).toBe(false)
  })

  it("prunes removed feature layers atomically and restores them with the source feature", () => {
    const { layer, applied } = applyFixture()
    const removed = textureSuccess(
      applyDocumentV3Command(applied.snapshot, {
        ...textureFixtureEnvelope(4),
        schemaVersion: 3,
        kind: "org.vibeshape.document.model-command",
        payload: {
          command: {
            ...textureFixtureEnvelope(4),
            schemaVersion: 1,
            kind: "org.vibeshape.feature.remove",
            payload: { featureId: layer.featureId },
          },
          partAllocations: [],
        },
      }),
    )
    expect(removed.snapshot.surfaceTextures).toEqual([])
    expect(removed.snapshot.features).toEqual([])
    const restored = textureSuccess(
      reduceDocumentV3Event(
        removed.snapshot,
        {
          ...textureFixtureEnvelope(5),
          schemaVersion: 3,
          type: "org.vibeshape.document.restored",
          transactionId: null,
          revision: 6,
          direction: "undo",
          targetRevision: applied.snapshot.revision,
        },
        applied.snapshot,
      ),
    )
    expect(restored.snapshot.surfaceTextures).toEqual([layer])
    expect(restored.snapshot.features).toEqual(applied.snapshot.features)
  })

  it("copies the complete mixed journal with texture settings and fresh external identities", () => {
    const { layer, events, applied } = applyFixture()
    const copied = textureSuccess(
      copyCompleteDocumentAuthorityHistory({
        sourceLegacyEvents: [],
        sourceSeed: null,
        sourceSnapshot: applied.snapshot,
        sourceEvents: [...events, applied.event],
        documentId: textureFixtureId(700),
        commandIds: Array.from({ length: 5 }, (_, index) => textureFixtureId(710 + index)),
        transactionIds: [],
        name: "Textured copy",
        issuedAt: applied.event.issuedAt,
        actor: applied.event.actor,
      }),
    )
    expect(copied.snapshot.schemaVersion).toBe(3)
    if (copied.snapshot.schemaVersion !== 3) throw new Error("Missing texture copy")
    expect(copied.snapshot.surfaceTextures).toEqual([layer])
    expect(copied.snapshot.id).toBe(textureFixtureId(700))
    expect(
      canonicalJson(
        textureSuccess(replayDocumentAuthorityEvents(copied.seed, copied.versionedEvents)).snapshot,
      ),
    ).toBe(canonicalJson(copied.snapshot))
  })
})
