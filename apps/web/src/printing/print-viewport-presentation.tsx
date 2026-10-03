import type { PrinterProfile } from "@vibeshape/protocol"
import type {
  GeometryViewport,
  GeometryViewportOptions,
  ViewerMesh,
} from "@vibeshape/viewer/three-viewport"
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react"
import { inspectViewportPrintVolume } from "./print-volume"
import { PrintVolumeStatus } from "./print-volume-status"

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewport | Promise<GeometryViewport>

export function usePrintViewportFactory(
  factory: ViewportFactory,
  meshes: readonly ViewerMesh[],
  profile?: PrinterProfile | null,
  visible = false,
  ground = false,
) {
  const report = useMemo(
    () => (profile ? inspectViewportPrintVolume(meshes, profile) : null),
    [meshes, profile],
  )
  const bed = useMemo(
    () => (visible && profile ? { ...profile, exceeded: report !== null && !report.fits } : null),
    [visible, profile, report],
  )
  const current = useRef({ bed, ground })
  current.current = { bed, ground }
  const configuredFactory = useCallback(
    async (canvas: HTMLCanvasElement, options: GeometryViewportOptions) => {
      const viewport = await factory(canvas, options)
      viewport.setPrintBed(current.current.bed)
      viewport.setGroundGrid(current.current.ground)
      return viewport
    },
    [factory],
  )
  return { factory: configuredFactory, report, bed, ground }
}

export function usePrintViewportSynchronization(
  viewport: RefObject<GeometryViewport | null>,
  presentation: ReturnType<typeof usePrintViewportFactory>,
) {
  useEffect(() => {
    viewport.current?.setPrintBed(presentation.bed)
    viewport.current?.setGroundGrid(presentation.ground)
  }, [presentation.bed, presentation.ground, viewport])
}

export function PrintViewportStatus({
  profile,
  visible,
  report,
  count,
}: {
  profile?: PrinterProfile | null | undefined
  visible?: boolean | undefined
  report: ReturnType<typeof inspectViewportPrintVolume>
  count: number
}) {
  if (!visible || !profile || count === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-12 right-3 max-w-64 rounded-md border bg-background/90 p-2">
      <PrintVolumeStatus profile={profile} report={report} compact />
    </div>
  )
}
