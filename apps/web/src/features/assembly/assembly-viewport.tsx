import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import type {
  GeometryViewport,
  GeometryViewportOptions,
  ViewerMesh,
} from "@vibeshape/viewer/three-viewport"
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  PrintViewportStatus,
  usePrintViewportFactory,
  usePrintViewportSynchronization,
} from "../../printing/print-viewport-presentation"
import { useBlockingViewport } from "../../shell/use-blocking-viewport"
import { useViewerPreferences } from "../../shell/viewer-preferences"

async function createAssemblyViewport(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
  const { createGeometryViewport } = await import("@vibeshape/viewer/three-viewport")
  return createGeometryViewport(canvas, options)
}

function occurrenceMeshes(inspection: AssemblyInspection): ViewerMesh[] {
  return inspection.occurrences.map(({ instanceId, sourceIndex, mesh }) => ({
    ...mesh,
    featureId: instanceId,
    outputRole: `assembly-source-${sourceIndex}`,
  }))
}
function selectedOccurrenceMesh(meshes: readonly ViewerMesh[], instanceId: string | null) {
  const selected = meshes.filter((mesh) => mesh.featureId === instanceId)
  if (!selected.length || !instanceId) return null
  const positions = new Float32Array(
    selected.reduce((length, mesh) => length + mesh.positions.length, 0),
  )
  const normals = new Float32Array(positions.length)
  const indices = new Uint32Array(
    selected.reduce((length, mesh) => length + mesh.indices.length, 0),
  )
  const triangleFaceIds = new Uint32Array(indices.length / 3)
  let positionOffset = 0,
    indexOffset = 0
  for (const mesh of selected) {
    positions.set(mesh.positions, positionOffset)
    normals.set(mesh.normals, positionOffset)
    indices.set(
      mesh.indices.map((index) => index + positionOffset / 3),
      indexOffset,
    )
    triangleFaceIds.set(mesh.triangleFaceIds, indexOffset / 3)
    positionOffset += mesh.positions.length
    indexOffset += mesh.indices.length
  }
  return { featureId: instanceId, positions, normals, indices, triangleFaceIds }
}
function useAssemblyViewportMount(
  canvas: RefObject<HTMLCanvasElement | null>,
  viewport: RefObject<GeometryViewport | null>,
  onSelect: (id: string | null) => void,
  readOnlyRef: RefObject<boolean>,
  factory: typeof createAssemblyViewport,
) {
  const [ready, setReady] = useState(false)
  useBlockingViewport(viewport)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    const element = canvas.current
    if (!element) return
    void factory(element, {
      onSelectionChange: (selection) => {
        if (selection && !readOnlyRef.current) onSelect(selection.featureId)
      },
    })
      .then((created) => {
        if (disposed) {
          created.dispose()
          return
        }
        viewport.current = created
        created.setInteractionMode(readOnlyRef.current ? "camera-only" : "select")
        created.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
        setReady(true)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      viewport.current?.dispose()
      viewport.current = null
    }
  }, [canvas, factory, onSelect, readOnlyRef, viewport])
  return { ready, failed }
}

function useAssemblyViewportRenderer(
  inspection: AssemblyInspection | null,
  selectedId: string | null,
  onSelect: (id: string | null) => void,
  autoFit: boolean,
  readOnly: boolean,
) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<GeometryViewport | null>(null)
  const readOnlyRef = useRef(readOnly)
  const previousReadOnly = useRef(readOnly)
  useLayoutEffect(() => {
    readOnlyRef.current = readOnly
    viewport.current?.setInteractionMode(readOnly ? "camera-only" : "select")
  }, [readOnly])
  const profile = useViewerPreferences((state) => state.printerProfile)
  const printBedVisible = useViewerPreferences((state) => state.printBedVisible)
  const groundGridVisible = useViewerPreferences((state) => state.groundGridVisible)
  const meshes = useMemo(() => (inspection ? occurrenceMeshes(inspection) : []), [inspection])
  const printPresentation = usePrintViewportFactory(
    createAssemblyViewport,
    meshes,
    profile,
    printBedVisible,
    groundGridVisible,
  )
  usePrintViewportSynchronization(viewport, printPresentation)
  const highlight = useMemo(
    () => (readOnly ? null : selectedOccurrenceMesh(meshes, selectedId)),
    [meshes, readOnly, selectedId],
  )
  const { ready, failed } = useAssemblyViewportMount(
    canvas,
    viewport,
    onSelect,
    readOnlyRef,
    printPresentation.factory,
  )
  useEffect(() => {
    if (!ready) return
    const toggled = previousReadOnly.current !== readOnly
    previousReadOnly.current = readOnly
    viewport.current?.setMeshes(meshes)
    if (autoFit && meshes.length && !toggled) viewport.current?.fit()
  }, [autoFit, meshes, readOnly, ready])
  useEffect(() => {
    if (ready) viewport.current?.setFeatureSelection(highlight)
  }, [highlight, ready])
  return {
    canvas,
    viewport,
    ready,
    failed,
    profile,
    printBedVisible,
    printPresentation,
    meshCount: meshes.length,
  }
}
export function AssemblyViewport({
  inspection,
  selectedId,
  onSelect,
  autoFit = true,
  readOnly = false,
}: {
  inspection: AssemblyInspection | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  autoFit?: boolean
  readOnly?: boolean
}) {
  const t = useTranslations("app.assembly")
  const view = useAssemblyViewportRenderer(inspection, selectedId, onSelect, autoFit, readOnly)
  return (
    <section className="relative h-full min-h-0" aria-label={t("viewportRegion")}>
      <canvas
        ref={view.canvas}
        role="img"
        className="block h-full w-full"
        aria-label={t("viewport")}
        data-assembly-selected-instance={readOnly ? "" : (selectedId ?? "")}
        data-read-only-presentation={readOnly ? "true" : undefined}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-3 right-3"
        disabled={!view.ready || view.failed}
        onClick={() => view.viewport.current?.fit()}
      >
        {t("fit")}
      </Button>
      <PrintViewportStatus
        profile={view.profile}
        visible={view.printBedVisible}
        report={view.printPresentation.report}
        count={view.meshCount}
      />
      {view.failed && <Alert className="absolute inset-x-3 top-3">{t("viewportFailed")}</Alert>}
    </section>
  )
}
