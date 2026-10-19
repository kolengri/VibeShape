import { useTranslations } from "@vibeshape/i18n"
import { nativeMeshFormatSchema } from "@vibeshape/slicer-handoff/native"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useReportApplicationError } from "../shell/application-notices"
import { type SlicerHandoffActions, useSlicerHandoff } from "./use-slicer-handoff"

type Handoff = ReturnType<typeof useSlicerHandoff>
type Controls = { handoff: Handoff; disabled: boolean }
function MeshFormatField({ handoff, disabled }: Controls) {
  const t = useTranslations("app.export.slicer.native")
  return (
    <NativeSelectField
      label={t("formatLabel")}
      value={handoff.preference.format}
      disabled={disabled}
      onChange={(event) => {
        const format = nativeMeshFormatSchema.safeParse(event.currentTarget.value)
        if (format.success) handoff.choosePreference(handoff.selected?.id ?? null, format.data)
      }}
    >
      <option value="3mf">3MF</option>
      <option value="stl">STL</option>
    </NativeSelectField>
  )
}
function SlicerApplicationField({ handoff, disabled }: Controls) {
  const t = useTranslations("app.export.slicer.native")
  if (!handoff.native) return null
  const { targets, selected, loading } = handoff
  return (
    <div className="grid gap-2">
      <NativeSelectField
        label={t("targetLabel")}
        description={t("targetDescription")}
        value={selected?.id ?? ""}
        disabled={disabled || loading || targets.length === 0}
        onChange={(event) => {
          const target = targets.find((item) => item.id === event.currentTarget.value)
          if (target) handoff.choosePreference(target.id, handoff.preference.format)
        }}
      >
        {targets.length === 0 ? (
          <option value="" />
        ) : (
          targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))
        )}
      </NativeSelectField>
      {!loading && targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noApplications")}</p>
      ) : null}
    </div>
  )
}
function SlicerSecondaryActions({ handoff, disabled }: Controls) {
  const t = useTranslations("app.export.slicer.native")
  return (
    <div className="flex flex-wrap gap-2">
      {handoff.native ? (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={handoff.chooseApplication}
        >
          {t("choose")}
        </Button>
      ) : null}
      {handoff.canReveal ? (
        <Button type="button" variant="outline" disabled={disabled} onClick={handoff.reveal}>
          {t("reveal")}
        </Button>
      ) : null}
    </div>
  )
}
function HandoffNotice({ status }: { status: Handoff["status"] }) {
  const t = useTranslations("app.export.slicer.native")
  const appOwnsError = useReportApplicationError(status?.failed ? t(status.key) : null)
  if (!status || (status.failed && appOwnsError)) return null
  return (
    <p
      role={status.failed ? "alert" : "status"}
      className={status.failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
    >
      {t(status.key)}
    </p>
  )
}

export function SlicerHandoffOptions({ handoff, disabled }: Controls) {
  return (
    <div className="grid gap-3">
      <SlicerApplicationField handoff={handoff} disabled={disabled} />
      <SlicerSecondaryActions handoff={handoff} disabled={disabled} />
      <HandoffNotice status={handoff.status} />
    </div>
  )
}
export function SlicerHandoffPanel({
  disabled,
  ...actions
}: { disabled: boolean } & SlicerHandoffActions) {
  const t = useTranslations("app.export.slicer.native")
  const common = useTranslations("app.export")
  const handoff = useSlicerHandoff(actions)
  const busy = disabled || handoff.pending
  return (
    <section className="grid gap-4 rounded-md border border-primary/30 bg-card p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{common("slicer.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(handoff.native ? "description" : "browserDescription")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <MeshFormatField handoff={handoff} disabled={busy} />
        <SlicerApplicationField handoff={handoff} disabled={busy} />
      </div>
      <div className="flex flex-wrap gap-2">
        <SlicerSecondaryActions handoff={handoff} disabled={busy} />
        <Button type="button" disabled={busy || !handoff.canSend} onClick={handoff.send}>
          {handoff.sendLabel}
        </Button>
      </div>
      <HandoffNotice status={handoff.status} />
    </section>
  )
}
