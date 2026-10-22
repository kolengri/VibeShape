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
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import { type DialogOpenProps, useDialogOpen } from "../../components/use-dialog-open"
import type { DocumentControllerState } from "../../document/document-controller"
import { historyCreationAfter } from "../../document/history-insertion"
import {
  type ImportDocumentContext,
  importSourceUnitSchema,
  importSourceUnits,
} from "./import-model"
import { ImportPreview } from "./import-preview"
import { type ImportTaskState, type ReadyImport, useImportTask } from "./use-import-task"

function importContext(controller: DocumentControllerState): ImportDocumentContext | null {
  const version = controller.authoredSnapshot?.schemaVersion
  const snapshot = controller.report?.snapshot
  if (!snapshot || (version !== 2 && version !== 3 && version !== 4 && version !== 5)) return null
  return {
    documentId: snapshot.id,
    revision: snapshot.revision,
    authorityVersion: version,
    historyAfter: historyCreationAfter(controller),
  }
}
function ImportSourceFields({ state }: { state: ImportTaskState }) {
  const t = useTranslations("app.import")
  return (
    <>
      <Field>
        <FieldLabel
          htmlFor="import-source-file"
          description={t("fileDescription")}
          descriptionId="import-file-description"
        >
          {t("file")}
        </FieldLabel>
        <Input
          id="import-source-file"
          aria-describedby="import-file-description"
          type="file"
          accept=".step,.stp,.brep,.stl,.3mf"
          onChange={(event) => state.chooseFile(event.currentTarget.files?.[0] ?? null)}
        />
      </Field>
      {state.requiresUnits ? (
        <SelectField
          label={t("unit")}
          value={state.unit ?? ""}
          required
          onValueChange={(value) => {
            const parsed = importSourceUnitSchema.safeParse(value)
            if (parsed.success) state.chooseUnit(parsed.data)
          }}
        >
          {importSourceUnits.map((unit) => (
            <SelectOption key={unit} value={unit}>
              {t(unit)}
            </SelectOption>
          ))}
        </SelectField>
      ) : (
        <p className="text-sm">{t("declaredUnits")}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {t(
          state.format === "stl"
            ? "stlUnitDescription"
            : state.format === "3mf"
              ? "threeMfUnitDescription"
              : "unitDescription",
        )}
      </p>
    </>
  )
}
function ImportInspection({
  ready,
  onReady,
}: {
  ready: ReadyImport
  onReady: (ready: boolean) => void
}) {
  const t = useTranslations("app.import")
  return (
    <section className="grid gap-3" aria-label={t("inspection")}>
      <p role="status" className="text-sm">
        {t(ready.prepared.representation === "exact-solid" ? "solidCount" : "meshCount", {
          count: ready.inspection.outputs.length,
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        {"unitEvidence" in ready.inspection ||
        (ready.prepared.representation === "triangle-mesh" && ready.prepared.input.format === "stl")
          ? t("explicitUnitEvidence")
          : t("declaredUnitEvidence", {
              unit: t(ready.inspection.normalization.sourceUnit),
            })}
      </p>
      {"warnings" in ready.inspection && (
        <>
          <p className="text-xs text-muted-foreground">{t("meshRepresentation")}</p>
          {ready.inspection.warnings.map((warning) => (
            <p key={warning.code} role="status" className="text-sm">
              {t("degenerateTriangles", { count: warning.count })}
            </p>
          ))}
        </>
      )}
      <ImportPreview
        inspection={ready.inspection}
        label={t("preview")}
        failedMessage={t("previewFailed")}
        onReady={onReady}
      />
    </section>
  )
}
function ImportTask({
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
  onApplyingChange: (applying: boolean) => void
}) {
  const t = useTranslations("app.import")
  const state = useImportTask({
    context,
    disabled,
    onImported,
    onApplyingChange,
    copy: {
      invalidFormat: t("invalidFormat"),
      invalidBudget: t("invalidBudget"),
      invalidFilename: t("invalidFilename"),
      invalidUnits: t("invalidUnits"),
      inspectFailed: t("inspectFailed"),
      saveFailed: t("saveFailed"),
      staleRevision: t("staleRevision"),
      featureLabel: (filename) => t("featureLabel", { filename }),
    },
  })
  const pending = state.activity !== "idle"
  return (
    <>
      <fieldset disabled={disabled || pending} aria-busy={pending} className="grid gap-4">
        <legend className="sr-only">{t("source")}</legend>
        <ImportSourceFields state={state} />
        <Button
          type="button"
          variant="outline"
          isLoading={state.activity === "inspecting"}
          disabled={!state.canInspect}
          onClick={() => void state.inspect()}
        >
          {t("inspect")}
        </Button>
      </fieldset>
      {state.ready && <ImportInspection ready={state.ready} onReady={state.setPreviewReady} />}
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
          onClick={() => void state.apply()}
        >
          {t("apply")}
        </Button>
      </DialogFooter>
    </>
  )
}
export function ImportDialog({
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
  const t = useTranslations("app.import")
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [applying, setApplying] = useState(false)
  const context = importContext(controller)
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
        className="sm:max-w-3xl"
        aria-busy={applying}
        closeLabel={t("close")}
        showCloseButton={!applying}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {context && open && (
          <ImportTask
            key={context.documentId}
            context={context}
            disabled={disabled && !applying}
            onImported={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            onApplyingChange={setApplying}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
