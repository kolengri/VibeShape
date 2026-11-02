import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { TopologyCandidate } from "@vibeshape/protocol"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  formatDisplayArea,
  formatDisplayLength,
  useDocumentDisplayUnits,
} from "../document/document-display-units"
import { SAFE_VIEWPORT_LEFT } from "./viewport-chrome-styles"

export type QuickMeasurement = Readonly<{ kind: "edge" | "face"; measure: number; radius?: number }>

export function quickMeasurement(
  candidate: Pick<TopologyCandidate, "kind" | "signature"> &
    Partial<Pick<TopologyCandidate, "referenceGeometry">>,
): QuickMeasurement | undefined {
  if (candidate.kind === "vertex") return undefined
  const geometry = candidate.referenceGeometry
  const radius =
    geometry &&
    (geometry.kind === "circle-edge" ||
      geometry.kind === "arc-edge" ||
      geometry.kind === "cylinder-face")
      ? geometry.radius
      : undefined
  return {
    kind: candidate.kind,
    measure: candidate.signature.measure,
    ...(radius === undefined ? {} : { radius }),
  }
}

/** Reserve the space above the axes and respect the workbench's measured chrome insets. */
export function QuickTopologyMeasurement({
  measurement,
}: {
  measurement: QuickMeasurement | undefined
}) {
  const t = useTranslations("app.topologyMeasurements")
  const formatter = useFormatter()
  const { length } = useDocumentDisplayUnits()
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 4 })
  const rows = measurement
    ? [
        {
          label: t(measurement.kind === "edge" ? "length" : "area"),
          value:
            measurement.kind === "edge"
              ? formatDisplayLength(measurement.measure, length, number)
              : formatDisplayArea(measurement.measure, length, number),
        },
        ...(measurement.radius === undefined
          ? []
          : [
              {
                label: t("radius"),
                value: formatDisplayLength(measurement.radius, length, number),
              },
              {
                label: t("diameter"),
                value: formatDisplayLength(2 * measurement.radius, length, number),
              },
            ]),
      ]
    : []
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none absolute bottom-24 left-2 overflow-hidden rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm max-h-[calc(100%_-_var(--workspace-chrome-top,0px)_-_var(--workspace-chrome-bottom,0px)_-_7rem)]",
        SAFE_VIEWPORT_LEFT,
      )}
    >
      {measurement ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1">
          {rows.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        t("unavailable")
      )}
    </div>
  )
}
