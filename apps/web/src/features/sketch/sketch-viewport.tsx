import type { SketchEntity, SketchRecord } from "@vibeshape/domain"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import { useEffect, useMemo, useState } from "react"
import {
  type ActiveSketchSolveResult,
  type DocumentControllerState,
  solveActiveSketch,
} from "../../document/document-controller"
import type { RectangleSketchPreview } from "./rectangle-sketch-form"

type SketchSolveFunction = (
  baseRevision: number,
  sketchId: SketchRecord["id"],
) => Promise<ActiveSketchSolveResult>

type SolveState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "solved"; solution: SolvedSketchWire }
  | { kind: "error" }

type DisplayPoint = Readonly<{ id: string; x: number; y: number }>
type DisplayLine = Readonly<{
  endPointId: string
  id: string
  startPointId: string
}>
type DisplayGeometry = Readonly<{
  draft: boolean
  lines: readonly DisplayLine[]
  points: readonly DisplayPoint[]
}>

function useSketchSolution(
  controller: DocumentControllerState,
  sketch: SketchRecord | null,
  enabled: boolean,
  solveSketch: SketchSolveFunction,
): SolveState {
  const [state, setState] = useState<SolveState>({ kind: "idle" })
  const revision = controller.report?.snapshot.revision
  const rebuildOk = controller.report?.rebuild.ok === true

  useEffect(() => {
    if (!enabled || !sketch || revision === undefined || !rebuildOk) {
      setState({ kind: "idle" })
      return
    }
    let cancelled = false
    setState({ kind: "loading" })
    void solveSketch(revision, sketch.id).then((result) => {
      if (cancelled) return
      setState(
        result.ok ? { kind: "solved", solution: result.response.solution } : { kind: "error" },
      )
    })
    return () => {
      cancelled = true
    }
  }, [enabled, rebuildOk, revision, sketch, solveSketch])

  return state
}

function lineEntities(sketch: SketchRecord): DisplayLine[] {
  return sketch.entities
    .filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line")
    .map(({ endPointId, id, startPointId }) => ({ endPointId, id, startPointId }))
}

function solvedPoints(solution: SolvedSketchWire): DisplayPoint[] {
  return solution.points.map(({ entityId, x, y }) => ({ id: entityId, x, y }))
}

function previewGeometry(preview: RectangleSketchPreview) {
  const points: DisplayPoint[] = [
    { id: "preview-a", x: 0, y: 0 },
    { id: "preview-b", x: preview.width, y: 0 },
    { id: "preview-c", x: preview.width, y: preview.height },
    { id: "preview-d", x: 0, y: preview.height },
  ]
  const lines: DisplayLine[] = [
    { id: "preview-ab", startPointId: "preview-a", endPointId: "preview-b" },
    { id: "preview-bc", startPointId: "preview-b", endPointId: "preview-c" },
    { id: "preview-cd", startPointId: "preview-c", endPointId: "preview-d" },
    { id: "preview-da", startPointId: "preview-d", endPointId: "preview-a" },
  ]
  return { lines, points }
}

function sketchBounds(points: readonly DisplayPoint[]) {
  if (points.length === 0) return { minX: -10, minY: -10, width: 20, height: 20 }
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const extent = Math.max(maxX - minX, maxY - minY, 1)
  const padding = Math.max(extent * 0.15, 2)
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  }
}

function SketchDrawing({
  ariaLabel,
  draft,
  lines,
  points,
}: {
  ariaLabel: string
  draft: boolean
  lines: readonly DisplayLine[]
  points: readonly DisplayPoint[]
}) {
  const bounds = sketchBounds(points)
  const pointsById = new Map(points.map((point) => [point.id, point]))
  return (
    <svg
      aria-label={ariaLabel}
      className="size-full"
      role="img"
      viewBox={`${bounds.minX} ${-bounds.minY - bounds.height} ${bounds.width} ${bounds.height}`}
    >
      <title>{ariaLabel}</title>
      <g transform="scale(1 -1)">
        <line
          x1={bounds.minX}
          y1={0}
          x2={bounds.minX + bounds.width}
          y2={0}
          className="stroke-muted-foreground/45"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={bounds.minY}
          x2={0}
          y2={bounds.minY + bounds.height}
          className="stroke-muted-foreground/45"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {lines.map((line) => {
          const start = pointsById.get(line.startPointId)
          const end = pointsById.get(line.endPointId)
          if (!start || !end) return null
          return (
            <line
              key={line.id}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className="stroke-primary"
              strokeDasharray={draft ? "6 4" : undefined}
              strokeLinecap="round"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {points.map((point) => (
          <circle
            key={point.id}
            cx={point.x}
            cy={point.y}
            r={3}
            className="fill-background stroke-primary"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  )
}

function displayGeometry(
  preview: RectangleSketchPreview | null,
  sketch: SketchRecord | null,
  solveState: SolveState,
): DisplayGeometry | null {
  if (preview) return { ...previewGeometry(preview), draft: true }
  if (!sketch || solveState.kind !== "solved") return null
  return {
    draft: false,
    lines: lineEntities(sketch),
    points: solvedPoints(solveState.solution),
  }
}

function solveStatusLabel(
  preview: RectangleSketchPreview | null,
  solveState: SolveState,
  labels: Readonly<Record<SolvedSketchWire["status"] | "preview", string>>,
) {
  if (preview) return labels.preview
  return solveState.kind === "solved" ? labels[solveState.solution.status] : null
}

function solveMessage(
  solveState: SolveState,
  copy: Readonly<{ empty: string; failed: string; loading: string }>,
) {
  if (solveState.kind === "loading") return copy.loading
  if (solveState.kind === "error") return copy.failed
  return copy.empty
}

function SketchViewportContent({
  geometry,
  message,
  previewDrawing,
  solveState,
  solvedDrawing,
}: {
  geometry: DisplayGeometry | null
  message: string
  previewDrawing: string
  solveState: SolveState
  solvedDrawing: string
}) {
  return geometry ? (
    <SketchDrawing
      ariaLabel={geometry.draft ? previewDrawing : solvedDrawing}
      draft={geometry.draft}
      lines={geometry.lines}
      points={geometry.points}
    />
  ) : (
    <div className="absolute inset-0 grid place-items-center px-6 text-center">
      <p
        className="max-w-sm text-sm text-muted-foreground"
        role={solveState.kind === "error" ? "alert" : "status"}
      >
        {message}
      </p>
    </div>
  )
}

function SketchSolveDetails({
  degreesOfFreedomText,
  geometry,
  profileText,
  status,
}: {
  degreesOfFreedomText: string | null
  geometry: DisplayGeometry | null
  profileText: string | null
  status: string | null
}) {
  if (!geometry) return null
  return (
    <div className="absolute left-3 top-3 grid gap-1 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm">
      <span className="font-medium" role="status">
        {status}
      </span>
      {degreesOfFreedomText ? (
        <span className="text-muted-foreground">{degreesOfFreedomText}</span>
      ) : null}
      {profileText ? <span className="text-muted-foreground">{profileText}</span> : null}
    </div>
  )
}

function SketchOrientation({ label }: { label: string | null }) {
  return label ? (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
      {label}
    </div>
  ) : null
}

export function SketchViewport({
  controller,
  preview,
  sketch,
  solveSketch = solveActiveSketch,
}: {
  controller: DocumentControllerState
  preview: RectangleSketchPreview | null
  sketch: SketchRecord | null
  solveSketch?: SketchSolveFunction
}) {
  const t = useTranslations("app.sketch.viewport")
  const formatter = useFormatter()
  const solveState = useSketchSolution(controller, sketch, preview === null, solveSketch)
  const geometry = useMemo(
    () => displayGeometry(preview, sketch, solveState),
    [preview, sketch, solveState],
  )
  const plane = preview?.plane ?? sketch?.plane
  const profile =
    solveState.kind === "solved" ? solveState.solution.profileResult.profiles[0] : null
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 3 })
  const status = solveStatusLabel(preview, solveState, {
    preview: t("preview"),
    "fully-constrained": t("fullyConstrained"),
    "under-constrained": t("underConstrained"),
    "over-constrained": t("overConstrained"),
    failed: t("failed"),
  })
  const profileText = profile
    ? t("profile", { area: number(profile.area), perimeter: number(profile.perimeter) })
    : null
  const degreesOfFreedomText =
    solveState.kind === "solved"
      ? t("degreesOfFreedom", { count: solveState.solution.degreesOfFreedom })
      : null

  return (
    <section
      aria-label={t("ariaLabel")}
      className="relative min-h-0 overflow-hidden bg-viewport-background"
    >
      <SketchViewportContent
        geometry={geometry}
        message={solveMessage(solveState, {
          loading: t("solving"),
          failed: t("solveFailed"),
          empty: t("empty"),
        })}
        previewDrawing={t("previewDrawing")}
        solveState={solveState}
        solvedDrawing={t("solvedDrawing")}
      />
      <SketchSolveDetails
        degreesOfFreedomText={degreesOfFreedomText}
        geometry={geometry}
        profileText={profileText}
        status={status}
      />
      <SketchOrientation label={plane ? t("orientation", { plane: plane.toUpperCase() }) : null} />
    </section>
  )
}
