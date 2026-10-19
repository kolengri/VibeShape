import type { RefObject } from "react"
import type { WorkflowModelState } from "./workflow-model-renderer"

export function WorkflowModelCanvas({
  canvasRef,
  hostRef,
  state,
  labels,
  hintId,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  hostRef: RefObject<HTMLDivElement | null>
  state: WorkflowModelState
  labels: Readonly<{ title: string; loading: string; unavailable: string }>
  hintId: string
}) {
  return (
    <div
      ref={hostRef}
      className="relative h-80 min-w-0 overflow-hidden rounded-lg border border-border bg-background sm:h-96"
      aria-busy={state === "loading"}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={labels.title}
        aria-describedby={hintId}
        tabIndex={state === "ready" ? 0 : -1}
        hidden={state === "unavailable"}
      />
      {state !== "ready" ? (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground"
        >
          {state === "loading" ? labels.loading : labels.unavailable}
        </p>
      ) : null}
    </div>
  )
}
