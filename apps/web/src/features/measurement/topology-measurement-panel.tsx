import {
  distanceBetweenMeasurementPoints,
  inspectTopologyMeasurements,
  type MeasurementPoint,
  parallelPlaneSeparation,
  type TopologyMeasurementElement,
  topologyDirectionAngle,
} from "@vibeshape/application/model-topology-measurements"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  formatDisplayAngle,
  formatDisplayArea,
  formatDisplayLength,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"

type Selection = { element: TopologyMeasurementElement; point: MeasurementPoint }
type Translation = ReturnType<typeof useTranslations<"app.topologyMeasurements">>

function ElementSelection({
  elements,
  label,
  value,
  onChange,
}: {
  elements: readonly TopologyMeasurementElement[]
  label: string
  value: Selection
  onChange: (selection: Selection) => void
}) {
  const t = useTranslations("app.topologyMeasurements")
  return (
    <div className="grid gap-2">
      <NativeSelectField
        label={label}
        value={value.element.id}
        onChange={(event) => {
          const element = elements.find(({ id }) => id === event.currentTarget.value)
          const point = element?.points[0]
          if (element && point) onChange({ element, point })
        }}
      >
        {elements.map((element, index) => (
          <option key={element.id} value={element.id}>
            {t(element.kind === "edge" ? "edgeElement" : "faceElement", {
              number: index + 1,
              geometry: element.geometryClass,
            })}
          </option>
        ))}
      </NativeSelectField>
      <NativeSelectField
        label={t("point")}
        value={value.point.kind}
        onChange={(event) => {
          const point = value.element.points.find(({ kind }) => kind === event.currentTarget.value)
          if (point) onChange({ ...value, point })
        }}
      >
        {value.element.points.map(({ kind }) => (
          <option key={kind} value={kind}>
            {t(`points.${kind}`)}
          </option>
        ))}
      </NativeSelectField>
    </div>
  )
}

function MeasurementRows({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt>{label}</dt>
          <dd className="font-mono tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function elementRows(
  element: TopologyMeasurementElement,
  t: Translation,
  length: (n: number) => string,
  area: (n: number) => string,
) {
  return [
    {
      label: t(element.kind === "edge" ? "length" : "area"),
      value: element.kind === "edge" ? length(element.measure) : area(element.measure),
    },
    ...(element.radius === undefined
      ? []
      : [{ label: t("diameter"), value: length(2 * element.radius) }]),
  ]
}

function PairMeasurements({ left, right }: { left: Selection; right: Selection }) {
  const t = useTranslations("app.topologyMeasurements")
  const formatter = useFormatter()
  const units = useDocumentDisplayUnits()
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 4 })
  const angle = topologyDirectionAngle(left.element, right.element)
  const separation = parallelPlaneSeparation(left.element, right.element)
  const rows = [
    {
      label: t("pointDistance"),
      value: formatDisplayLength(
        distanceBetweenMeasurementPoints(left.point.position, right.point.position),
        units.length,
        number,
      ),
    },
    ...(angle === null
      ? []
      : [{ label: t("directionAngle"), value: formatDisplayAngle(angle, units.angle, number) }]),
    ...(separation === null
      ? []
      : [
          {
            label: t("planeDistance"),
            value: formatDisplayLength(separation, units.length, number),
          },
        ]),
  ]
  return (
    <>
      <MeasurementRows rows={rows} />
      <p className="text-xs text-muted-foreground">{t("pairScope")}</p>
    </>
  )
}

function AvailableTopologyMeasurements({
  elements,
}: {
  elements: readonly TopologyMeasurementElement[]
}) {
  const t = useTranslations("app.topologyMeasurements")
  const formatter = useFormatter()
  const { length } = useDocumentDisplayUnits()
  const first = elements[0]
  const second = elements[1] ?? first
  const [left, setLeft] = useState<Selection | null>(() =>
    first?.points[0] ? { element: first, point: first.points[0] } : null,
  )
  const [right, setRight] = useState<Selection | null>(() =>
    second?.points[0] ? { element: second, point: second.points[0] } : null,
  )
  const [compare, setCompare] = useState(false)
  if (!left || !right) return <p className="text-xs text-muted-foreground">{t("empty")}</p>
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 4 })
  const rows = elementRows(
    left.element,
    t,
    (n) => formatDisplayLength(n, length, number),
    (n) => formatDisplayArea(n, length, number),
  )
  return (
    <div className="grid gap-3">
      <ElementSelection elements={elements} label={t("element")} value={left} onChange={setLeft} />
      <MeasurementRows rows={rows} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={compare}
          onChange={(event) => setCompare(event.currentTarget.checked)}
        />
        {t("compare")}
      </label>
      {compare ? (
        <>
          <ElementSelection
            elements={elements}
            label={t("secondElement")}
            value={right}
            onChange={setRight}
          />
          <PairMeasurements left={left} right={right} />
        </>
      ) : null}
    </div>
  )
}

export function TopologyMeasurementPanel({
  controller,
  featureId,
  outputRole,
}: {
  controller: DocumentControllerState
  featureId: string
  outputRole: string | undefined
}) {
  const t = useTranslations("app.topologyMeasurements")
  const report = controller.report
  const elements = useMemo(() => {
    if (
      controller.status !== "ready" ||
      controller.saveStatus === "saving" ||
      !report ||
      !outputRole
    )
      return null
    return inspectTopologyMeasurements(report.snapshot, report.rebuild, {
      schemaVersion: 0,
      featureId: featureIdSchema.parse(featureId),
      outputRole,
    })
  }, [controller.status, controller.saveStatus, report, featureId, outputRole])
  const evidenceKey = report?.rebuild.ok
    ? `${report.rebuild.response.generation}:${report.rebuild.response.requestId}`
    : "unavailable"
  return (
    <section className="mt-4 grid gap-3 border-t pt-4" aria-label={t("title")}>
      <h3 className="text-sm font-medium">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      {elements ? (
        <AvailableTopologyMeasurements
          key={`${report?.snapshot.revision}:${evidenceKey}:${featureId}:${outputRole}`}
          elements={elements}
        />
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {t("unavailable")}
        </p>
      )}
    </section>
  )
}
