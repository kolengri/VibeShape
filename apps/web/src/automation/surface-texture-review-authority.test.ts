import type { SurfaceTextureReviewInput } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { surfaceTextureCommandSchema } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { describe, expect, it } from "vitest"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
} from "../../../../tests/fixtures/surface-texture-project"
import type { AutomationReviewState } from "./automation-review-state"
import { surfaceTextureReviewedInputMatches } from "./surface-texture-automation-preview"

function fixture() {
  const { snapshot, layer } = surfaceTextureProjectFixture()
  const actor = commandActorSchema.parse({
    type: "mcp",
    clientId: "org.example.texture",
    sessionId: textureFixtureId(9),
  })
  const input: SurfaceTextureReviewInput = {
    kind: "surface-texture",
    actor,
    documentName: snapshot.name,
    featureName: "Housing",
    operation: "create",
    layerId: layer.id,
    draft: {
      draftId: textureFixtureId(500),
      baseRevision: snapshot.revision,
      draftVersion: 0,
      expiresAt: "2099-01-01T00:00:00Z",
    },
    command: surfaceTextureCommandSchema.parse({
      schemaVersion: 3,
      kind: "org.vibeshape.document.metadata-command",
      commandId: textureFixtureId(501),
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      issuedAt: "2026-10-04T00:00:00Z",
      actor,
      payload: { kind: "textures.replace-layers", featureId: layer.featureId, layers: [layer] },
    }),
    preview: { bodyCount: 1, sourceTriangleCount: 12, triangleCount: 48, vertexCount: 26 },
  }
  const review: AutomationReviewState = {
    id: "review",
    status: "applying",
    diagnostic: null,
    input: structuredClone(input),
  }
  return { input, review }
}

describe("private reviewed surface texture grant", () => {
  it("requires the exact reviewed actor, base, draft version, collection and lifetime", () => {
    const { input, review } = fixture()
    expect(surfaceTextureReviewedInputMatches(review, input)).toBe(true)
    const mutations = [
      (value: SurfaceTextureReviewInput) => {
        Object.assign(value.draft, { baseRevision: input.draft.baseRevision + 1 })
      },
      (value: SurfaceTextureReviewInput) => {
        Object.assign(value.draft, { draftVersion: 1 })
      },
      (value: SurfaceTextureReviewInput) => {
        Object.assign(value.draft, { draftId: textureFixtureId(999) })
      },
      (value: SurfaceTextureReviewInput) => {
        Object.assign(value.actor, { sessionId: textureFixtureId(998) })
      },
      (value: SurfaceTextureReviewInput) => {
        const layer = value.command.payload.layers[0]
        if (layer) layer.heightMm = 0.7
      },
      (value: SurfaceTextureReviewInput) => {
        Object.assign(value, { operation: "remove" })
      },
      (value: SurfaceTextureReviewInput) => {
        Object.assign(value, { layerId: textureFixtureId(997) })
      },
    ]
    for (const mutate of mutations) {
      const changed = structuredClone(input)
      mutate(changed)
      expect(surfaceTextureReviewedInputMatches(review, changed)).toBe(false)
    }
    expect(surfaceTextureReviewedInputMatches({ ...review, status: "error" }, input)).toBe(false)
    expect(
      surfaceTextureReviewedInputMatches(review, input, Date.parse(input.draft.expiresAt)),
    ).toBe(false)
  })
})
