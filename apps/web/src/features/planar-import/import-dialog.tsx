import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { Field, FieldDescription, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import { type DialogOpenProps, useDialogOpen } from "../../components/use-dialog-open"
import type { DocumentControllerState } from "../../document/document-controller"
import { historyCreationAfter } from "../../document/history-insertion"
import type { ImportDocumentContext } from "../import/import-model"
import { planarPlaneSchema, planarUnitSchema, planarUnits } from "./import-model"
import { PlanarImportPreview } from "./import-preview"
import { type PlanarImportState, usePlanarImport } from "./use-planar-import"

function Fields({ state }: { state: PlanarImportState }) {
  const t = useTranslations("app.planarImport")
  return (
    <>
      <Field>
        <FieldLabel htmlFor="planar-source-file">{t("file")}</FieldLabel>
        <Input
          id="planar-source-file"
          type="file"
          accept=".dxf,.svg"
          onChange={(event) => state.chooseFile(event.currentTarget.files?.[0] ?? null)}
        />
        <FieldDescription>{t("fileDescription")}</FieldDescription>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("unit")}
          value={state.unit ?? ""}
          required
          onValueChange={(value) => {
            const unit = planarUnitSchema.safeParse(value)
            if (unit.success) state.chooseUnit(unit.data)
          }}
        >
          {planarUnits
            .filter((unit) => (state.format === "dxf" ? unit !== "px" : unit !== "declared"))
            .map((unit) => (
              <SelectOption key={unit} value={unit}>
                {t(unit)}
              </SelectOption>
            ))}
        </SelectField>
        <SelectField
          label={t("plane")}
          value={state.plane}
          required
          onValueChange={(value) => {
            const plane = planarPlaneSchema.safeParse(value)
            if (plane.success) state.choosePlane(plane.data)
          }}
        >
          {planarPlaneSchema.options.map((plane) => (
            <SelectOption key={plane} value={plane}>
              {t(plane)}
            </SelectOption>
          ))}
        </SelectField>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(state.format === "dxf" ? "dxfPolicy" : "svgPolicy")}
      </p>
    </>
  )
}
function Inspection({ state }: { state: PlanarImportState }) {
  const t = useTranslations("app.planarImport")
  const ready = state.ready
  if (!ready) return null
  const paths = ready.inspection.prepared.paths
  const { min, max } = ready.inspection.bounds
  const units = ready.inspection.prepared.units
  const sourceUnit = planarUnitSchema.parse(units.sourceUnit)
  return (
    <section className="grid gap-2" aria-label={t("inspection")}>
      <p role="status" className="text-sm">
        {t("counts", {
          paths: paths.length,
          closed: paths.filter((path) => path.closed).length,
          curves: paths.reduce((count, path) => count + path.segments.length, 0),
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("units", { unit: t(sourceUnit), scale: units.millimetersPerUnit })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("bounds", { minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] })}
      </p>
      <PlanarImportPreview inspection={ready.inspection} label={t("preview")} />
      <p className="text-xs text-muted-foreground">{t("orientation")}</p>
      <p className="text-xs text-muted-foreground">{t("capacity")}</p>
    </section>
  )
}
function Task({
  context,
  disabled,
  onImported,
  onCancel,
  onApplyingChange,
}: {
  context: ImportDocumentContext
  disabled: boolean
  onImported: () => void
  onCancel: () => void
  onApplyingChange: (value: boolean) => void
}) {
  const t = useTranslations("app.planarImport")
  const state = usePlanarImport({
    context,
    disabled,
    onImported,
    onApplyingChange,
    copy: {
      format: t("invalidFormat"),
      budget: t("invalidBudget"),
      filename: t("invalidFilename"),
      units: t("invalidUnits"),
      inspectFailed: t("inspectFailed"),
      timeout: t("timeout"),
      saveFailed: t("saveFailed"),
      stale: t("stale"),
      diagnostic: (message, source) => (source ? t("diagnostic", { message, source }) : message),
      sketchLabel: (filename) => t("sketchLabel", { filename }),
    },
  })
  return (
    <>
      <fieldset
        disabled={disabled || state.activity !== "idle"}
        aria-busy={state.activity === "inspecting"}
        className="grid gap-3"
      >
        <legend className="sr-only">{t("source")}</legend>
        <Fields state={state} />
        <Button
          type="button"
          variant="outline"
          isLoading={state.activity === "inspecting"}
          disabled={!state.canInspect}
          onClick={state.inspect}
        >
          {t("inspect")}
        </Button>
      </fieldset>
      <Inspection state={state} />
      {state.activity === "inspecting" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("inspecting")}
        </p>
      )}
      {state.message && <Alert>{state.message}</Alert>}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={state.activity === "applying"}
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          isLoading={state.activity === "applying"}
          disabled={!state.canApply}
          onClick={state.apply}
        >
          {t("apply")}
        </Button>
      </DialogFooter>
    </>
  )
}
export function PlanarImportDialog({
  controller,
  blocked,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: DialogOpenProps & {
  controller: DocumentControllerState
  blocked: boolean
}) {
  const t = useTranslations("app.planarImport")
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [applying, setApplying] = useState(false)
  const snapshot = controller.report?.snapshot
  const version = controller.authoredSnapshot?.schemaVersion
  const context =
    snapshot && (version === 2 || version === 3 || version === 4 || version === 5)
      ? {
          documentId: snapshot.id,
          revision: snapshot.revision,
          authorityVersion: version,
          historyAfter: historyCreationAfter(controller),
        }
      : null
  const disabled =
    blocked ||
    !context ||
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    controller.report?.mode !== "read-write"
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!applying) setOpen(next)
      }}
    >
      {showTrigger ? (
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" disabled={disabled}>
            {t("trigger")}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        closeLabel={t("close")}
        showCloseButton={!applying}
        aria-busy={applying}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open && context && (
          <Task
            key={context.documentId}
            context={context}
            disabled={disabled && !applying}
            onImported={() => {
              setApplying(false)
              setOpen(false)
            }}
            onCancel={() => setOpen(false)}
            onApplyingChange={setApplying}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
