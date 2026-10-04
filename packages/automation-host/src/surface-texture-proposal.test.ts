import { localFailure } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain/commands"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { applyDocumentV3Command } from "@vibeshape/domain/document-v3-commands"
import { promoteDocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import { applyDocumentV4AuthoredCommand } from "@vibeshape/domain/document-v4-commands"
import { describe, expect, it, vi } from "vitest"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
  textureSuccess,
} from "../../../tests/fixtures/surface-texture-project"
import { createSurfaceTextureProposalCoordinator } from "./surface-texture-proposal"
import {
  SURFACE_TEXTURE_PROPOSAL_TTL_MS,
  type SurfaceTextureProposalConfiguration,
  surfaceTextureCommandSchema,
} from "./surface-texture-proposal-contract"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.texture",
  sessionId: textureFixtureId(9),
})
const preview = { bodyCount: 1, sourceTriangleCount: 12, triangleCount: 48, vertexCount: 26 }
const started = Date.parse("2026-10-04T00:00:00Z")
function setup(v4 = false) {
  const fixture = surfaceTextureProjectFixture()
  let snapshot: AuthoredDocumentSnapshot = v4
    ? promoteDocumentSnapshotV4(fixture.snapshot)
    : fixture.snapshot
  let active = true
  let time = started
  let sequence = 500
  const read = vi.fn<SurfaceTextureProposalConfiguration["readSnapshot"]>(() => snapshot)
  const native = vi.fn<SurfaceTextureProposalConfiguration["preview"]>(async () => ({
    ok: true,
    value: preview,
  }))
  const review = vi.fn<SurfaceTextureProposalConfiguration["review"]>(async () => "approved")
  const commit = vi.fn<SurfaceTextureProposalConfiguration["commit"]>(async (input) => {
    snapshot = textureSuccess(
      snapshot.schemaVersion === 4
        ? applyDocumentV4AuthoredCommand(snapshot, input.command)
        : applyDocumentV3Command(snapshot, input.command),
    ).snapshot
    return { ok: true as const, value: { documentId: snapshot.id, revision: snapshot.revision } }
  })
  const coordinator = createSurfaceTextureProposalCoordinator({
    documentId: snapshot.id,
    readSnapshot: read,
    isActive: () => active,
    createId: () => textureFixtureId(++sequence),
    preview: native,
    commit,
    review,
    now: () => time,
  })
  const { id: _id, featureId: _feature, ...recipe } = fixture.layer
  const create = {
    tool: "create_surface_texture",
    arguments: {
      baseRevision: snapshot.revision,
      layerId: fixture.layer.id,
      featureId: fixture.layer.featureId,
      recipe,
    },
  }
  return {
    coordinator,
    read,
    native,
    review,
    commit,
    create,
    layer: fixture.layer,
    snapshot: () => snapshot,
    replace: (next: AuthoredDocumentSnapshot) => {
      snapshot = next
    },
    revoke: () => {
      active = false
    },
    expire: () => {
      time += SURFACE_TEXTURE_PROPOSAL_TTL_MS
    },
  }
}

describe("owned surface texture proposal coordination", () => {
  it("rechecks revocation after an asynchronous captured authority read", async () => {
    const f = setup()
    const captured = f.snapshot()
    let release: (value: AuthoredDocumentSnapshot) => void = () => undefined
    f.read.mockImplementationOnce(
      () =>
        new Promise<AuthoredDocumentSnapshot>((resolve) => {
          release = resolve
        }),
    )
    const pending = f.coordinator.execute(actor, f.create)
    await Promise.resolve()
    f.revoke()
    release(captured)
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    expect(f.native).not.toHaveBeenCalled()
    expect(f.review).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
  })

  it("locks concurrent operations and never persists a disposed pending manual review", async () => {
    const f = setup()
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    f.review.mockImplementationOnce(
      () =>
        new Promise<"approved">((resolve) => {
          release = () => resolve("approved")
          entered()
        }),
    )
    const pending = f.coordinator.execute(actor, f.create)
    await waiting
    expect(await f.coordinator.execute(actor, f.create)).toMatchObject({
      ok: false,
      diagnostic: { code: "busy" },
    })
    f.coordinator.dispose()
    release()
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    expect(f.commit).not.toHaveBeenCalled()
  })

  it("reports an unconfirmed save when the private port returns the wrong document or revision", async () => {
    for (const wrongDocument of [false, true]) {
      const f = setup()
      f.commit.mockResolvedValueOnce({
        ok: true,
        value: {
          documentId: wrongDocument ? textureFixtureId(999) : f.snapshot().id,
          revision: f.snapshot().revision + (wrongDocument ? 1 : 2),
        },
      })
      expect(await f.coordinator.execute(actor, f.create)).toMatchObject({
        ok: false,
        diagnostic: { code: "document-commit-failed", retryable: true },
      })
      expect(f.commit).toHaveBeenCalledOnce()
    }
  })

  it("preflights before and after manual review and retains ordinary V2/V4 authority", async () => {
    for (const v4 of [false, true]) {
      const f = setup(v4)
      const before = f.snapshot()
      expect(await f.coordinator.execute(actor, f.create)).toMatchObject({
        ok: true,
        value: {
          baseRevision: before.revision,
          revision: before.revision + 1,
          operation: "create",
        },
      })
      expect(f.native).toHaveBeenCalledTimes(2)
      expect(f.review).toHaveBeenCalledOnce()
      const review = f.review.mock.calls[0]?.[0]
      expect(review).toMatchObject({
        kind: "surface-texture",
        actor,
        operation: "create",
        command: { actor, payload: { kind: "textures.replace-layers" } },
        preview,
      })
      expect(f.commit).toHaveBeenCalledOnce()
      expect(f.snapshot().schemaVersion).toBe(v4 ? 4 : 3)
      if (v4 && before.schemaVersion === 4 && f.snapshot().schemaVersion === 4)
        expect(f.snapshot()).toMatchObject({ assembly: before.assembly, assets: before.assets })
    }
  })

  it("preserves omitted custom pixels, target and ordered mask while appending within the domain cap", async () => {
    const f = setup()
    const pixels = Array.from({ length: 256 ** 2 }, () => 255)
    const created = {
      ...f.create,
      arguments: {
        ...f.create.arguments,
        recipe: {
          ...f.create.arguments.recipe,
          map: {
            kind: "custom",
            width: 256,
            height: 256,
            grayscaleBase64: `${"/".repeat(87380)}/w==`,
          },
        },
      },
    }
    expect(await f.coordinator.execute(actor, created)).toMatchObject({ ok: true })
    const stroke = {
      center: [1, 2, 3],
      normal: [0, 0, 1],
      radiusMm: 2,
      hardness: 0.5,
      mode: "paint",
    }
    expect(
      await f.coordinator.execute(actor, {
        tool: "update_surface_texture",
        arguments: {
          baseRevision: f.snapshot().revision,
          layerId: f.layer.id,
          patch: { heightMm: 0.6 },
          appendMaskStrokes: Array.from({ length: 2048 }, () => stroke),
        },
      }),
    ).toMatchObject({ ok: true })
    const current = f.snapshot()
    if (current.schemaVersion === 2) throw new Error("No saved texture authority")
    expect(current.surfaceTextures[0]).toMatchObject({
      map: { pixels: [...pixels] },
      target: f.layer.target,
      mask: { base: "all", strokes: Array.from({ length: 2048 }, () => stroke) },
    })
    const calls = f.commit.mock.calls.length
    expect(
      await f.coordinator.execute(actor, {
        tool: "update_surface_texture",
        arguments: {
          baseRevision: current.revision,
          layerId: f.layer.id,
          appendMaskStrokes: [stroke],
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "surface-texture-mask-limit" } })
    expect(f.commit.mock.calls).toHaveLength(calls)
  })

  it.each([
    "native-before",
    "native-after",
    "review-reject",
    "review-expire",
    "review-revoke",
    "preview-revision",
    "preview-cancel",
  ])("never saves after %s invalidates the owned proposal", async (kind) => {
    const f = setup()
    if (kind === "native-before")
      f.native.mockResolvedValueOnce(localFailure("native-failed", "Relief is invalid."))
    if (kind === "native-after")
      f.native
        .mockResolvedValueOnce({ ok: true, value: preview })
        .mockResolvedValueOnce(localFailure("native-failed", "Relief is invalid."))
    if (kind === "review-reject") f.review.mockResolvedValueOnce("rejected")
    if (kind === "review-expire")
      f.review.mockImplementationOnce(async () => {
        f.expire()
        return "approved"
      })
    if (kind === "review-revoke")
      f.review.mockImplementationOnce(async () => {
        f.revoke()
        return "approved"
      })
    if (kind === "preview-revision")
      f.native.mockImplementationOnce(async () => {
        f.replace({ ...f.snapshot(), revision: f.snapshot().revision + 1 })
        return { ok: true, value: preview }
      })
    if (kind === "preview-cancel")
      f.native.mockImplementationOnce(async () => {
        f.coordinator.cancel()
        return { ok: true, value: preview }
      })
    expect(await f.coordinator.execute(actor, f.create)).toMatchObject({ ok: false })
    expect(f.commit).not.toHaveBeenCalled()
    if (kind === "native-before") expect(f.review).not.toHaveBeenCalled()
  })

  it("isolates retained intent from preview/review mutation and narrows the private command to texture replacement", async () => {
    const f = setup()
    f.native.mockImplementationOnce(async (input) => {
      const layer = input.command.payload.layers[0]
      if (!layer) throw new Error("The reviewed layer is missing")
      layer.heightMm = 99
      Object.assign(input.draft, { expiresAt: "2099-01-01T00:00:00Z" })
      return { ok: true, value: preview }
    })
    f.review.mockImplementationOnce(async (input) => {
      const layer = input.command.payload.layers[0]
      if (!layer) throw new Error("The reviewed layer is missing")
      layer.heightMm = 88
      return "approved"
    })
    expect(await f.coordinator.execute(actor, f.create)).toMatchObject({ ok: true })
    expect(f.commit.mock.calls[0]?.[0].command.payload.layers[0]?.heightMm).toBe(f.layer.heightMm)
    expect(
      surfaceTextureCommandSchema.safeParse({
        ...f.commit.mock.calls[0]?.[0].command,
        payload: { kind: "part.rename", partId: textureFixtureId(100), name: "Unexpected" },
      }).success,
    ).toBe(false)
  })

  it("keeps read summaries bounded and gates actor ownership, disposal and exact removal review", async () => {
    const f = setup()
    expect(await f.coordinator.execute(actor, f.create)).toMatchObject({ ok: true })
    const result = await f.coordinator.execute(actor, {
      tool: "model_surface_textures",
      arguments: { revision: f.snapshot().revision, featureId: f.layer.featureId },
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        layers: [
          { map: { kind: "builtin" }, mask: { strokeCount: 0 }, target: { faceReferenceCount: 0 } },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain('"strokes"')
    expect(
      await f.coordinator.execute(
        { ...actor, sessionId: textureFixtureId(99) },
        {
          tool: "remove_surface_texture",
          arguments: { baseRevision: f.snapshot().revision, layerId: f.layer.id },
        },
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
    expect(
      await f.coordinator.execute(actor, {
        tool: "remove_surface_texture",
        arguments: { baseRevision: f.snapshot().revision, layerId: f.layer.id },
      }),
    ).toMatchObject({ ok: true, value: { operation: "remove" } })
    expect(f.review.mock.calls.at(-1)?.[0]).toMatchObject({
      operation: "remove",
      layerId: f.layer.id,
      command: { payload: { layers: [] } },
    })
    f.coordinator.dispose()
    expect(await f.coordinator.execute(actor, f.create)).toMatchObject({
      ok: false,
      diagnostic: { code: "session-revoked" },
    })
  })
})
