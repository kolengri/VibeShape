import type { FeatureId } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useEffect, useRef } from "react"
import { formatShellMeasurement } from "./shell-form-model"
import type { ShellPickingContext, ShellPickRequest } from "./shell-picking"

export type BodyFaceChecklistCopy = Readonly<{
  legend: string
  description: string
  count: (values: { selected: number; total: number }) => string
  faceName: (values: { number: number }) => string
  face: (values: { number: number; area: string; x: string; y: string; z: string }) => string
}>

/** Keyboard-accessible list of every face of one exact body, mirroring viewport picking. */
export function BodyFaceChecklist({
  copy,
  name,
  evidence,
  selectedIds,
  onBlur,
  onChange,
}: Readonly<{
  copy: BodyFaceChecklistCopy
  name: string
  evidence: ModelBodyTopologyEvidence | null
  selectedIds: readonly string[]
  onBlur?: () => void
  onChange: (ids: string[]) => void
}>) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-xs font-medium">{copy.legend}</legend>
      <p className="text-xs text-muted-foreground">{copy.description}</p>
      <details className="min-w-0 rounded-md border">
        <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">
          {copy.count({ selected: selectedIds.length, total: evidence?.candidates.length ?? 0 })}
        </summary>
        <div className="grid max-h-48 gap-1 overflow-y-auto overscroll-contain border-t p-2">
          {evidence?.candidates.map((candidate, index) => {
            const measurement = copy.face({
              number: index + 1,
              area: formatShellMeasurement(candidate.signature.measure),
              x: formatShellMeasurement(candidate.signature.centroid[0]),
              y: formatShellMeasurement(candidate.signature.centroid[1]),
              z: formatShellMeasurement(candidate.signature.centroid[2]),
            })
            return (
              <Tooltip key={candidate.candidateId}>
                <TooltipTrigger asChild>
                  <label className="flex min-h-6 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      name={name}
                      checked={selectedIds.includes(candidate.candidateId)}
                      onBlur={onBlur}
                      onChange={(event) =>
                        onChange(
                          event.currentTarget.checked
                            ? [...selectedIds, candidate.candidateId]
                            : selectedIds.filter((id) => id !== candidate.candidateId),
                        )
                      }
                    />
                    <span aria-hidden="true">{copy.faceName({ number: index + 1 })}</span>
                    <span className="sr-only">{measurement}</span>
                  </label>
                </TooltipTrigger>
                <TooltipContent>{measurement}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </details>
    </fieldset>
  )
}

/**
 * Publishes the face-picking context for the viewport and applies each new pick request once.
 * `pick` returns the next selection, or null when the request is stale or rejected.
 */
export function BodyFacePickingSync({
  enabled,
  evidence,
  featureId,
  target,
  selectedIds,
  request,
  onContextChange,
  pick,
  onSelectionChange,
}: Readonly<{
  enabled: boolean
  evidence: ModelBodyTopologyEvidence | null
  featureId: FeatureId
  target: BodyReference
  selectedIds: readonly string[]
  request: ShellPickRequest | null
  onContextChange: ((context: ShellPickingContext | null) => void) | undefined
  pick: (request: ShellPickRequest) => string[] | null
  onSelectionChange: (ids: string[]) => void
}>) {
  const lastSequence = useRef<number | null>(null)
  useEffect(() => {
    onContextChange?.(
      evidence && enabled
        ? {
            featureId,
            targetBody: {
              schemaVersion: 0,
              featureId: target.featureId,
              outputRole: target.outputRole,
            },
            evidence,
            openingIds: selectedIds,
          }
        : null,
    )
  }, [
    enabled,
    evidence,
    featureId,
    onContextChange,
    target.featureId,
    target.outputRole,
    selectedIds,
  ])
  // Withdraw the context only when this picker unmounts or changes owner. A cleanup on every
  // publish would store null and then the equal context again, so an equal republish would never
  // be a no-op upstream.
  useEffect(() => () => onContextChange?.(null), [featureId, onContextChange])
  useEffect(() => {
    if (!request || lastSequence.current === request.sequence) return
    lastSequence.current = request.sequence
    if (request.featureId !== featureId || request.sourceContentHash !== evidence?.contentHash)
      return
    const ids = pick(request)
    if (ids) onSelectionChange(ids)
  }, [evidence?.contentHash, featureId, onSelectionChange, pick, request])
  return null
}
