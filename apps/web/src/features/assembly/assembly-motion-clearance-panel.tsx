import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { TextField } from "@vibeshape/ui/components/text-field"
import { useState } from "react"
import type { AssemblyMotionCoordinate } from "./assembly-motion"
import type { MotionClearanceResult } from "./assembly-motion-clearance"
import { captureMotionClearance } from "./motion-clearance-operation"
import type { MotionClearanceView } from "./use-motion-clearance"

function ClearanceResults({
  result,
  display,
  unit,
  names,
  show,
  disabled,
}: {
  result: MotionClearanceResult
  display: (value: number) => string
  unit: string
  names: Readonly<Record<string, string>>
  show: (value: number, poseDigest: string) => void
  disabled: boolean
}) {
  const t = useTranslations("motionClearance")
  const pairName = (left: string, right: string) =>
    `${names[left] ?? left} / ${names[right] ?? right}`
  const smallest = result.smallest
  const smallestPose = result.samples.find(({ value }) => value === smallest?.value)?.poseDigest
  return (
    <div className="grid min-w-0 gap-2">
      <p className="text-xs">
        {t("coverage", {
          completed: result.samples.length,
          total: result.requestedSamples,
          start: display(result.start),
          end: display(result.end),
          resolution: display(result.resolution),
          unit,
          minimumGap: result.minimumGap,
        })}
      </p>
      {result.status === "incomplete" ? (
        <Alert>{t("incomplete", { reason: t(result.reason ?? "unavailable") })}</Alert>
      ) : (
        <p className="text-xs">{t("complete")}</p>
      )}
      {smallest && (
        <div className="grid min-w-0 gap-1 text-xs">
          <p className="break-words">
            {t("smallest", {
              gap: smallest.distance,
              value: display(smallest.value),
              unit,
              pair: pairName(smallest.leftInstanceId, smallest.rightInstanceId),
            })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => smallestPose && show(smallest.value, smallestPose)}
          >
            {t("showSmallest")}
          </Button>
        </div>
      )}
      {result.samples
        .filter((sample) => sample.pairs.some((pair) => pair.volume > 0 || pair.violatesMinimumGap))
        .map((sample) => (
          <div key={sample.value} className="grid min-w-0 gap-1 border-t pt-2 text-xs">
            <p>{t("position", { value: display(sample.value), unit })}</p>
            {sample.pairs
              .filter((pair) => pair.volume > 0 || pair.violatesMinimumGap)
              .map((pair) => (
                <p key={`${pair.leftInstanceId}:${pair.rightInstanceId}`} className="break-words">
                  {t(pair.volume > 0 ? "collision" : "violation", {
                    pair: pairName(pair.leftInstanceId, pair.rightInstanceId),
                    gap: pair.distance,
                    volume: pair.volume,
                  })}
                </p>
              ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => show(sample.value, sample.poseDigest)}
            >
              {t("showPosition", { value: display(sample.value), unit })}
            </Button>
          </div>
        ))}
    </div>
  )
}
type ClearancePanelInput = {
  jointId: string
  coordinate: AssemblyMotionCoordinate
  range: () => { start: number; end: number }
  display: (value: number) => string
  unit: string
  names: Readonly<Record<string, string>>
}
function clearanceRequest(input: ClearancePanelInput, minimumGap: string, count: string) {
  const capture = captureMotionClearance()
  return {
    documentId: capture?.documentId ?? "00000000-0000-7000-8000-000000000000",
    revision: capture?.revision ?? 0,
    actor: { type: "user" as const, userId: null },
    jointId: input.jointId,
    coordinate: input.coordinate.kind,
    ...input.range(),
    sampleCount: count.trim() ? Number(count) : Number.NaN,
    minimumGap: minimumGap.trim() ? Number(minimumGap) : Number.NaN,
  }
}
export function AssemblyMotionClearancePanel({
  input,
  clearance,
  disabled,
  onStart,
  onShow,
}: {
  input: ClearancePanelInput
  clearance: MotionClearanceView
  disabled: boolean
  onStart: () => void
  onShow: (value: number, poseDigest: string) => void
}) {
  const { display, unit, names } = input
  const t = useTranslations("motionClearance")
  const [minimumGap, setMinimumGap] = useState(() =>
    String(captureMotionClearance()?.defaultMinimumGap ?? 0.2),
  )
  const [count, setCount] = useState("13")
  const run = () => {
    onStart()
    return clearance.run(clearanceRequest(input, minimumGap, count))
  }
  return (
    <section aria-label={t("title")} className="grid min-w-0 gap-2 border-t pt-3">
      <h3 className="text-xs font-medium">{t("title")}</h3>
      <TextField
        type="number"
        label={t("minimumGap")}
        value={minimumGap}
        min={0}
        max={100000}
        step="any"
        disabled={clearance.pending || disabled}
        onChange={(event) => setMinimumGap(event.currentTarget.value)}
      />
      <TextField
        type="number"
        label={t("samples")}
        value={count}
        min={2}
        max={64}
        step={1}
        disabled={clearance.pending || disabled}
        onChange={(event) => setCount(event.currentTarget.value)}
      />
      <p className="text-xs text-muted-foreground">{t("scope")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || clearance.pending}
          aria-busy={clearance.pending}
          isLoading={clearance.pending}
          onClick={run}
        >
          {t("check")}
        </Button>
        {clearance.pending && (
          <Button type="button" size="sm" variant="outline" onClick={clearance.cancel}>
            {t("cancel")}
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite" aria-busy={clearance.pending} className="text-xs">
        {clearance.pending && (
          <p>{clearance.progress ? t("progress", clearance.progress) : t("preparing")}</p>
        )}
      </div>
      {clearance.result && (
        <ClearanceResults
          result={clearance.result}
          display={display}
          unit={unit}
          names={names}
          show={onShow}
          disabled={disabled || clearance.pending || clearance.result.reason === "stale"}
        />
      )}
    </section>
  )
}
