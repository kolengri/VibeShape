import type { ModelBodyMeasurementView } from "@vibeshape/automation-api/queries"
import { cubicMillimetersToVolume } from "@vibeshape/domain"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useState } from "react"
import {
  formatDisplayArea,
  formatDisplayLength,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"

type Entry = ModelBodyMeasurementView["data"]["bodies"][number]

function bodyEntryKey(entry: Entry) {
  return `${entry.featureId}\u0000${entry.outputRole ?? ""}`
}

function selectedBodyEntry(entries: readonly Entry[], selectedId: string) {
  return entries.find((entry) => bodyEntryKey(entry) === selectedId) ?? entries[0]
}

function bodyLabel(
  entries: readonly Entry[],
  entry: Entry,
  unnamedLabel: string,
  formatLabel: (values: { feature: string; number: number }) => string,
  formatRoleLabel: (values: { feature: string; role: string }) => string,
) {
  const sameFeature = entries.filter((candidate) => candidate.featureId === entry.featureId)
  if (sameFeature.length < 2) return entry.label ?? unnamedLabel
  const roleOrdinal = entry.outputRole?.match(/(?:^|\.)(\d+)$/)?.[1]
  if (roleOrdinal !== undefined) {
    return formatLabel({
      feature: entry.label ?? unnamedLabel,
      number: Number(roleOrdinal) + 1,
    })
  }
  return entry.outputRole
    ? formatRoleLabel({ feature: entry.label ?? unnamedLabel, role: entry.outputRole })
    : formatLabel({ feature: entry.label ?? unnamedLabel, number: sameFeature.indexOf(entry) + 1 })
}

type MeasurementPanelProps = Readonly<{
  view: ModelBodyMeasurementView | null
  unavailable: boolean
  unavailableMessage: "unavailable" | "featureNotMeasurable" | "bodyNotFound"
  onPrevious: (() => void) | undefined
  onNext: (() => void) | undefined
  onAllOutputs: (() => void) | undefined
  onClose: () => void
}>

function ShapeMeasurements({ entry }: Readonly<{ entry: Entry }>) {
  const t = useTranslations("app.shell.taskPanel.measurement")
  const formatter = useFormatter()
  const { length } = useDocumentDisplayUnits()
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 4 })
  const { shape } = entry
  const rows = [
    {
      label: t("volume"),
      value: `${number(cubicMillimetersToVolume(shape.volume, length))} ${length}³`,
    },
    { label: t("surfaceArea"), value: formatDisplayArea(shape.surfaceArea, length, number) },
    {
      label: t("width"),
      value: formatDisplayLength(shape.bounds.max[0] - shape.bounds.min[0], length, number),
    },
    {
      label: t("depth"),
      value: formatDisplayLength(shape.bounds.max[1] - shape.bounds.min[1], length, number),
    },
    {
      label: t("height"),
      value: formatDisplayLength(shape.bounds.max[2] - shape.bounds.min[2], length, number),
    },
    { label: t("solids"), value: number(shape.solidCount) },
  ]
  return (
    <dl className="mt-4 grid gap-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt>{row.label}</dt>
          <dd className="font-mono tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function MeasurementResult({ entry }: Readonly<{ entry: Entry | undefined }>) {
  const t = useTranslations("app.shell.taskPanel.measurement")
  if (!entry) return <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
  return <ShapeMeasurements entry={entry} />
}

function MeasurementPaging({
  total,
  onPrevious,
  onNext,
}: Readonly<{
  total: number
  onPrevious: (() => void) | undefined
  onNext: (() => void) | undefined
}>) {
  const t = useTranslations("app.shell.taskPanel.measurement")
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!onPrevious}
        {...(onPrevious ? { onClick: onPrevious } : {})}
      >
        {t("previous")}
      </Button>
      <span className="text-xs text-muted-foreground">{t("count", { total })}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!onNext}
        {...(onNext ? { onClick: onNext } : {})}
      >
        {t("next")}
      </Button>
    </div>
  )
}

export function MeasurementPanel({
  view,
  unavailable,
  unavailableMessage,
  onPrevious,
  onNext,
  onAllOutputs,
  onClose,
}: MeasurementPanelProps) {
  const t = useTranslations("app.shell.taskPanel.measurement")
  return (
    <aside aria-label={t("title")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{t("title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
      {onAllOutputs ? (
        <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={onAllOutputs}>
          {t("allOutputs")}
        </Button>
      ) : null}
      {unavailable ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {t(unavailableMessage)}
        </p>
      ) : (
        <AvailableMeasurementPanel view={view} onPrevious={onPrevious} onNext={onNext} />
      )}
    </aside>
  )
}

function AvailableMeasurementPanel({
  view,
  onPrevious,
  onNext,
}: Readonly<{
  view: ModelBodyMeasurementView | null
  onPrevious: (() => void) | undefined
  onNext: (() => void) | undefined
}>) {
  const t = useTranslations("app.shell.taskPanel.measurement")
  const [selectedId, setSelectedId] = useState("")
  const entries = view?.data.bodies ?? []
  const selected = selectedBodyEntry(entries, selectedId)
  return (
    <>
      {selected ? (
        <NativeSelectField
          className="mt-4"
          label={t("output")}
          value={bodyEntryKey(selected)}
          onChange={(event) => setSelectedId(event.currentTarget.value)}
        >
          {entries.map((entry) => (
            <option key={bodyEntryKey(entry)} value={bodyEntryKey(entry)}>
              {bodyLabel(
                entries,
                entry,
                t("unnamed"),
                (values) => t("bodyOutput", values),
                (values) => t("bodyOutputRole", values),
              )}
            </option>
          ))}
        </NativeSelectField>
      ) : null}
      <MeasurementResult entry={selected} />
      {view ? (
        <MeasurementPaging total={view.data.total} onPrevious={onPrevious} onNext={onNext} />
      ) : null}
    </>
  )
}
