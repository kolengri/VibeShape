import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import type {
  ViewerSelection,
  ViewerSurfaceTextureBrush,
  ViewerSurfaceTextureDab,
} from "@vibeshape/viewer/three-viewport"
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"
import type { TextureDraft } from "./use-texture-draft"

type Mask = SurfaceTextureLayer["mask"]
type Mode = "navigate" | "faces" | "paint" | "erase"

function appendDab(
  item: SurfaceTextureLayer,
  dab: ViewerSurfaceTextureDab,
  radiusMm: number,
  hardness: number,
  mode: "paint" | "erase",
) {
  if (item.mask.strokes.length >= 2048) return item
  return {
    ...item,
    mask: {
      ...item.mask,
      strokes: [
        ...item.mask.strokes,
        {
          center: dab.center,
          normal: dab.normal,
          radiusMm,
          hardness,
          mode: dab.erase ? ("erase" as const) : mode,
        },
      ],
    },
  }
}

export function useTextureBrush(
  draft: TextureDraft | null,
  layer: SurfaceTextureLayer | null,
  writable: boolean,
  setDraft: Dispatch<SetStateAction<TextureDraft | null>>,
  pickFace: (picked: ViewerSelection) => void,
  update: (patch: Partial<SurfaceTextureLayer>) => void,
) {
  const setBrush = useSurfaceTexturePreviewContext()?.setBrush
  const [pickMode, setPickMode] = useState<Mode>("navigate")
  const [radiusMm, setRadiusMm] = useState(3)
  const [hardness, setHardness] = useState(0.7)
  const [maskHistory, setMaskHistory] = useState<readonly Mask[]>([])
  const [strokeActive, setStrokeActive] = useState(false)
  const strokeStart = useRef<{ layerId: string; mask: Mask } | null>(null)
  useEffect(() => {
    if (!writable || pickMode === "navigate") {
      setBrush?.(null)
      return
    }
    const brush: ViewerSurfaceTextureBrush = {
      featureId: draft?.featureId ?? null,
      outputRole: draft?.outputRole ?? null,
      mode: pickMode,
      radiusMm,
      hardness,
      onStart: () => {
        if (!layer || pickMode === "faces") return
        strokeStart.current = { layerId: layer.id, mask: layer.mask }
        setStrokeActive(true)
        setMaskHistory((history) => [...history.slice(-31), layer.mask])
      },
      onDab: (dab) => {
        if (pickMode === "faces") return pickFace(dab.selection)
        const selectedId = strokeStart.current?.layerId
        setDraft((current) =>
          current
            ? {
                ...current,
                layers: current.layers.map((item) =>
                  item.id === selectedId
                    ? appendDab(item, dab, radiusMm, hardness, pickMode)
                    : item,
                ),
              }
            : null,
        )
      },
      onEnd: (cancelled) => {
        const start = strokeStart.current
        if (cancelled && start) {
          setDraft((current) =>
            current
              ? {
                  ...current,
                  layers: current.layers.map((item) =>
                    item.id === start.layerId ? { ...item, mask: start.mask } : item,
                  ),
                }
              : null,
          )
          setMaskHistory((history) => history.slice(0, -1))
        }
        strokeStart.current = null
        setStrokeActive(false)
      },
    }
    setBrush?.(brush)
  }, [
    writable,
    pickMode,
    draft?.featureId,
    draft?.outputRole,
    layer,
    radiusMm,
    hardness,
    setBrush,
    pickFace,
    setDraft,
  ])
  useEffect(() => () => setBrush?.(null), [setBrush])
  function undoMask() {
    if (strokeStart.current) return
    const mask = maskHistory.at(-1)
    if (!mask) return
    update({ mask })
    setMaskHistory((history) => history.slice(0, -1))
  }
  return {
    pickMode,
    setPickMode,
    radiusMm,
    setRadiusMm,
    hardness,
    setHardness,
    maskUndoAvailable: maskHistory.length > 0 && !strokeActive,
    strokeActive,
    undoMask,
    resetHistory: () => setMaskHistory([]),
  }
}
