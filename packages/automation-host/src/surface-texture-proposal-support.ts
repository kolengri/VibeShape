import {
  decodeSurfaceTextureMap,
  type SurfaceTextureMutationOperation,
  surfaceTextureSummarySchema,
  surfaceTexturesViewSchema,
} from "@vibeshape/automation-api/surface-texture-tools"
import type { CommandActor } from "@vibeshape/domain/commands"
import { authoredDocumentSnapshotSchema } from "@vibeshape/domain/document-v2"
import { applyDocumentV3Command } from "@vibeshape/domain/document-v3-commands"
import { applyDocumentV4AuthoredCommand } from "@vibeshape/domain/document-v4-commands"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import {
  MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE,
  type SurfaceTextureLayer,
  surfaceTextureLayerSchema,
} from "@vibeshape/domain/surface-textures"
import {
  SURFACE_TEXTURE_PROPOSAL_TTL_MS,
  type SurfaceTextureAuthority,
  type SurfaceTextureProposalConfiguration,
  type SurfaceTextureReviewedInput,
  surfaceTextureCommandSchema,
} from "./surface-texture-proposal-contract"

export class SurfaceTexturePreparationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function readSurfaceTextureAuthority(value: unknown) {
  return authoredDocumentSnapshotSchema.parse(value)
}
function summarizeSurfaceTexture(layer: SurfaceTextureLayer) {
  return surfaceTextureSummarySchema.parse({
    ...layer,
    target: {
      kind: layer.target.kind,
      outputRole: layer.target.outputRole,
      faceReferenceCount: layer.target.kind === "faces" ? layer.target.refs.length : 0,
    },
    map:
      layer.map.kind === "builtin"
        ? layer.map
        : {
            kind: "custom",
            width: layer.map.width,
            height: layer.map.height,
            pixelCount: layer.map.pixels.length,
          },
    mask: { base: layer.mask.base, strokeCount: layer.mask.strokes.length },
  })
}
export function readSurfaceTextures(snapshot: SurfaceTextureAuthority, featureId: string) {
  if (!snapshot.features.some(({ id }) => id === featureId))
    throw new SurfaceTexturePreparationError(
      "surface-texture-feature-unavailable",
      "The selected texture feature is unavailable.",
    )
  return surfaceTexturesViewSchema.parse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    featureId,
    layers: (snapshot.schemaVersion === 2 ? [] : snapshot.surfaceTextures)
      .filter((layer) => layer.featureId === featureId)
      .map(summarizeSurfaceTexture),
  })
}

function textureSettings(
  operation: Extract<SurfaceTextureMutationOperation, { tool: "update_surface_texture" }>,
  current: SurfaceTextureLayer,
) {
  const { patch, appendMaskStrokes } = operation.arguments
  if (current.mask.strokes.length + (appendMaskStrokes?.length ?? 0) > 2048)
    throw new SurfaceTexturePreparationError(
      "surface-texture-mask-limit",
      "The texture mask may contain at most 2048 brush dabs.",
    )
  return surfaceTextureLayerSchema.parse({
    ...current,
    ...patch,
    map: patch.map === undefined ? current.map : decodeSurfaceTextureMap(patch.map),
    mask:
      appendMaskStrokes === undefined
        ? (patch.mask ?? current.mask)
        : {
            ...current.mask,
            strokes: [...current.mask.strokes, ...appendMaskStrokes],
          },
  })
}
function mutationLayers(
  snapshot: SurfaceTextureAuthority,
  operation: SurfaceTextureMutationOperation,
) {
  const layers = snapshot.schemaVersion === 2 ? [] : snapshot.surfaceTextures
  if (operation.tool === "create_surface_texture") {
    const { layerId: id, featureId, recipe } = operation.arguments
    if (layers.some((layer) => layer.id === id))
      throw new SurfaceTexturePreparationError(
        "surface-texture-layer-exists",
        "The texture layer already exists.",
      )
    if (
      layers.filter((layer) => layer.featureId === featureId).length >=
      MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE
    )
      throw new SurfaceTexturePreparationError(
        "surface-texture-layer-limit",
        "A feature may have at most four surface texture layers.",
      )
    const layer = surfaceTextureLayerSchema.parse({
      ...recipe,
      id,
      featureId,
      map: decodeSurfaceTextureMap(recipe.map),
    })
    return {
      featureId,
      layers: [...layers.filter((layer) => layer.featureId === featureId), layer],
      kind: "create" as const,
    }
  }
  const current = layers.find(({ id }) => id === operation.arguments.layerId)
  if (!current)
    throw new SurfaceTexturePreparationError(
      "surface-texture-layer-unavailable",
      "The texture layer is unavailable at the selected revision.",
    )
  const owned = layers.filter(({ featureId }) => featureId === current.featureId)
  if (operation.tool === "remove_surface_texture")
    return {
      featureId: current.featureId,
      layers: owned.filter(({ id }) => id !== current.id),
      kind: "remove" as const,
    }
  const updated = textureSettings(operation, current)
  return {
    featureId: current.featureId,
    layers: owned.map((layer) => (layer.id === current.id ? updated : layer)),
    kind: "update" as const,
  }
}
export function prepareSurfaceTextureProposal(
  configuration: SurfaceTextureProposalConfiguration,
  snapshot: SurfaceTextureAuthority,
  operation: SurfaceTextureMutationOperation,
  actor: CommandActor,
  now: number,
) {
  const change = mutationLayers(snapshot, operation)
  const feature = snapshot.features.find(({ id }) => id === change.featureId)
  if (!feature)
    throw new SurfaceTexturePreparationError(
      "surface-texture-feature-unavailable",
      "The texture layer requires a current producing feature.",
    )
  const command = surfaceTextureCommandSchema.parse({
    schemaVersion: 3,
    kind: "org.vibeshape.document.metadata-command",
    commandId: configuration.createId(),
    documentId: snapshot.id,
    baseRevision: snapshot.revision,
    issuedAt: new Date(now).toISOString(),
    actor,
    payload: {
      kind: "textures.replace-layers",
      featureId: change.featureId,
      layers: change.layers,
    },
  })
  const applied =
    snapshot.schemaVersion === 4
      ? applyDocumentV4AuthoredCommand(snapshot, command)
      : applyDocumentV3Command(snapshot, command)
  if (!applied.ok)
    throw new SurfaceTexturePreparationError(
      "surface-texture-command-rejected",
      applied.diagnostic.message.slice(0, 512),
    )
  const input: SurfaceTextureReviewedInput = {
    actor,
    command,
    draft: {
      draftId: draftIdSchema.parse(configuration.createId()),
      baseRevision: snapshot.revision,
      draftVersion: 0,
      expiresAt: new Date(now + SURFACE_TEXTURE_PROPOSAL_TTL_MS).toISOString(),
    },
    operation: change.kind,
    layerId: operation.arguments.layerId,
  }
  return { input, documentName: snapshot.name, featureName: feature.label ?? feature.id }
}
