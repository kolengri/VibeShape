import { useTranslations } from "@vibeshape/i18n"
import { nativeMeshFormatSchema } from "@vibeshape/slicer-handoff/native"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useReportApplicationError } from "../shell/application-notices"
import { type ActionContainer, OptionalActionPortal } from "./optional-action-portal"
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
function SlicerSecondaryActions({
  handoff,
  disabled,
  compact = false,
}: Controls & { compact?: boolean }) {
  const t = useTranslations("app.export.slicer.native")
  if (!handoff.native && !handoff.canReveal) return null
  return (
    <div className="flex flex-wrap gap-2">
      {handoff.native ? (
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size="sm"
          className="h-auto min-h-8 whitespace-normal text-left"
          disabled={disabled}
          onClick={handoff.chooseApplication}
        >
          {t("choose")}
        </Button>
      ) : null}
      {handoff.canReveal ? (
        <Button
          type="button"
          size="sm"
          variant={compact ? "ghost" : "outline"}
          disabled={disabled}
          onClick={handoff.reveal}
        >
          {t("reveal")}
        </Button>
      ) : null}
    </div>
  )
}
function useHandoffMessage(status: Handoff["status"]) {
  const t = useTranslations("app.export.slicer.native")
  if (!status) return null
  return status.details ? t("exportFailedDetails", { details: status.details }) : t(status.key)
}
function HandoffNotice({ status, attempt }: { status: Handoff["status"]; attempt: number }) {
  const message = useHandoffMessage(status)
  const failed = status?.failed ?? false
  const appOwnsError = useReportApplicationError(failed ? message : null, attempt)
  if (!message) return null
  if (!failed)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {message}
      </p>
    )
  if (appOwnsError) return null
  return <Alert className="fixed inset-x-4 bottom-4 z-50">{message}</Alert>
}

export function SlicerHandoffOptions({ handoff, disabled }: Controls) {
  return (
    <div className="grid gap-2 [&_[data-slot=field-error]:not([role=alert])]:hidden">
      <SlicerApplicationField handoff={handoff} disabled={disabled} />
      <SlicerSecondaryActions handoff={handoff} disabled={disabled} compact />
      <HandoffNotice status={handoff.status} attempt={handoff.attempt} />
    </div>
  )
}
export function SlicerHandoffPanel({
  disabled,
  actionContainer,
  ...actions
}: { disabled: boolean; actionContainer?: ActionContainer } & SlicerHandoffActions) {
  const t = useTranslations("app.export.slicer.native")
  const common = useTranslations("app.export")
  const handoff = useSlicerHandoff(actions)
  const busy = disabled || handoff.pending
  const sendAction = (
    <Button type="button" disabled={busy || !handoff.canSend} onClick={handoff.send}>
      {handoff.sendLabel}
    </Button>
  )
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
        <OptionalActionPortal container={actionContainer}>{sendAction}</OptionalActionPortal>
      </div>
      <HandoffNotice status={handoff.status} attempt={handoff.attempt} />
    </section>
  )
}
