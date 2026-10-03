import { canonicalJson } from "@vibeshape/domain"
import {
  createDefaultSurfaceTextureLayer,
  type SurfaceTextureLayer,
  surfaceTextureLayerIdSchema,
} from "@vibeshape/domain/surface-textures"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useCallback, useEffect, useState } from "react"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import type { DocumentControllerState } from "../../document/document-controller"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"
import { textureFaceReference } from "./surface-texture-selection"
import { useTextureBrush } from "./use-texture-brush"

type Body = Readonly<{ featureId: SurfaceTextureLayer["featureId"]; outputRole: string }>
export type TextureDraft = Body &
  Readonly<{ layers: readonly SurfaceTextureLayer[]; selectedId: string | null }>

function newLayer(body: Body) {
  return createDefaultSurfaceTextureLayer(
    body.featureId,
    body.outputRole,
    surfaceTextureLayerIdSchema.parse(browserAuthoredUuid()),
  )
}

function savedLayers(controller: DocumentControllerState) {
  const snapshot = controller.authoredSnapshot
  return snapshot && "surfaceTextures" in snapshot ? snapshot.surfaceTextures : []
}

function bodyDraft(
  controller: DocumentControllerState,
  body: Body,
  selection: ViewerSelection | null,
): TextureDraft {
  const layers = savedLayers(controller).filter(({ featureId }) => featureId === body.featureId)
  const existing = layers.find(({ target }) => target.outputRole === body.outputRole)
  if (existing) return { ...body, layers, selectedId: existing.id }
  if (layers.length >= 4) return { ...body, layers, selectedId: null }
  const layer = newLayer(body)
  const ref =
    selection &&
    selection.featureId === body.featureId &&
    (selection.outputRole ?? "result") === body.outputRole
      ? textureFaceReference(controller, selection)
      : null
  const candidate = ref
    ? { ...layer, target: { kind: "faces" as const, outputRole: body.outputRole, refs: [ref] } }
    : layer
  return { ...body, layers: [...layers, candidate], selectedId: candidate.id }
}

export function useTextureDraft(
  controller: DocumentControllerState,
  selection: ViewerSelection | null,
  initialBody: Body | null,
) {
  const preview = useSurfaceTexturePreviewContext()
  const [baseRevision] = useState(controller.report?.snapshot.revision ?? 0)
  const [draft, setDraft] = useState<TextureDraft | null>(() =>
    initialBody ? bodyDraft(controller, initialBody, selection) : null,
  )
  const layer = draft?.layers.find(({ id }) => id === draft.selectedId) ?? null
  const update = useCallback((patch: Partial<SurfaceTextureLayer>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            layers: current.layers.map((item) =>
              item.id === current.selectedId ? { ...item, ...patch } : item,
            ),
          }
        : null,
    )
  }, [])
  const pickFace = useCallback(
    (picked: ViewerSelection) => {
      const body = {
        featureId: picked.featureId as Body["featureId"],
        outputRole: picked.outputRole ?? "result",
      }
      if (!draft) {
        setDraft(bodyDraft(controller, body, picked))
        return
      }
      if (draft.featureId !== body.featureId || draft.outputRole !== body.outputRole || !layer)
        return
      const ref = textureFaceReference(controller, picked)
      if (!ref) return
      const refs = layer.target.kind === "faces" ? layer.target.refs : []
      if (refs.some((existing) => canonicalJson(existing) === canonicalJson(ref))) return
      update({
        target: { kind: "faces", outputRole: body.outputRole, refs: [...refs, ref] },
        mask: { base: "all", strokes: [] },
      })
    },
    [controller, draft, layer, update],
  )
  useEffect(() => {
    if (!draft && selection) pickFace(selection)
  }, [draft, selection, pickFace])
  const setPreviewDraft = preview?.setDraft
  useEffect(() => {
    const documentId = controller.report?.snapshot.id
    setPreviewDraft?.(
      draft && documentId
        ? { documentId, revision: baseRevision, featureId: draft.featureId, layers: draft.layers }
        : null,
    )
  }, [draft, baseRevision, controller.report?.snapshot.id, setPreviewDraft])
  useEffect(
    () => () => {
      setPreviewDraft?.(null)
    },
    [setPreviewDraft],
  )
  const writable =
    controller.report?.mode === "read-write" &&
    controller.report.snapshot.revision === baseRevision &&
    controller.saveStatus !== "saving"
  const brush = useTextureBrush(draft, layer, writable, setDraft, pickFace, update)
  return {
    draft,
    layer,
    baseRevision,
    writable,
    update,
    isUnchanged: () =>
      draft !== null &&
      canonicalJson(draft.layers) ===
        canonicalJson(
          savedLayers(controller).filter(({ featureId }) => featureId === draft.featureId),
        ),
    ...brush,
    chooseBody: (body: Body) => {
      setDraft((current) => chooseDraftBody(controller, current, body))
      brush.resetHistory()
      brush.setPickMode("navigate")
    },
    selectLayer: (id: string) => {
      setDraft((current) => {
        const selected = current?.layers.find((item) => item.id === id)
        return current && selected
          ? { ...current, selectedId: id, outputRole: selected.target.outputRole }
          : current
      })
      brush.resetHistory()
      brush.setPickMode("navigate")
    },
    addLayer: () => {
      if (!draft || draft.layers.length >= 4) return
      const added = { ...newLayer(draft), mask: { base: "empty" as const, strokes: [] } }
      setDraft({ ...draft, layers: [...draft.layers, added], selectedId: added.id })
      brush.setPickMode("faces")
    },
    removeLayer: () => {
      brush.resetHistory()
      brush.setPickMode("navigate")
      setDraft((current) => {
        if (!current) return null
        const layers = current.layers.filter(({ id }) => id !== current.selectedId)
        const selected = layers.at(-1)
        return {
          ...current,
          layers,
          selectedId: selected?.id ?? null,
          outputRole: selected?.target.outputRole ?? current.outputRole,
        }
      })
    },
  }
}

function chooseDraftBody(
  controller: DocumentControllerState,
  current: TextureDraft | null,
  body: Body,
): TextureDraft {
  if (!current || current.featureId !== body.featureId) return bodyDraft(controller, body, null)
  const selected = current.layers.find((layer) => layer.target.outputRole === body.outputRole)
  if (selected) return { ...current, ...body, selectedId: selected.id }
  if (current.layers.length >= 4) return { ...current, ...body, selectedId: null }
  const added = newLayer(body)
  return { ...current, ...body, layers: [...current.layers, added], selectedId: added.id }
}
