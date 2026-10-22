import type { SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { SketchTextOutlineError } from "./text-model"
import { type SketchTextTarget, type SketchTextTask, useSketchTextTask } from "./use-sketch-text"

function TextDimensions({ form }: Pick<SketchTextTask, "form">) {
  const t = useTranslations("app.sketchText")
  return (
    <div className="grid gap-2">
      {(["height", "tracking", "originX", "originY"] as const).map((name) => (
        <form.AppField key={name} name={name}>
          {(field) => <field.TextField label={t(name)} type="number" step="any" required />}
        </form.AppField>
      ))}
    </div>
  )
}
function TextAlignment({ form }: Pick<SketchTextTask, "form">) {
  const t = useTranslations("app.sketchText")
  return (
    <div className="grid gap-2">
      <form.AppField name="horizontal">
        {(field) => (
          <field.SelectField label={t("horizontal")}>
            {(["left", "center", "right"] as const).map((value) => (
              <SelectOption key={value} value={value}>
                {t(value)}
              </SelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppField name="vertical">
        {(field) => (
          <field.SelectField label={t("vertical")}>
            {(["baseline", "bottom", "center", "top"] as const).map((value) => (
              <SelectOption key={value} value={value}>
                {t(value)}
              </SelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
    </div>
  )
}
function TextRegenerationNotice({ state }: { state: SketchTextTask }) {
  const t = useTranslations("app.sketchText")
  const { form } = state
  return (
    <>
      {state.altered === null && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("checkingOutline")}
        </p>
      )}
      {state.altered && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {t("alteredOutline")}
        </p>
      )}
      {state.constraints > 0 && (
        <div className="grid gap-2 rounded-md border p-3">
          <p className="text-sm">{t("attachedConstraints", { count: state.constraints })}</p>
          <form.AppField name="removeAttachedConstraints">
            {(field) => <field.CheckboxField label={t("removeConstraints")} />}
          </form.AppField>
        </div>
      )}
    </>
  )
}
function TextTask({
  target,
  getDraft,
  onDraftChange,
  onClose,
}: {
  target: SketchTextTarget
  getDraft: () => SketchRecord | null
  onDraftChange: (draft: SketchRecord) => void
  onClose: () => void
}) {
  const t = useTranslations("app.sketchText")
  const problem = (error: SketchTextOutlineError) => {
    const diagnostic = error.diagnostic
    if (diagnostic.code === "missing-glyph")
      return t("missingGlyph", {
        codePoint: `U+${(diagnostic.codePoint ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
        position: (diagnostic.glyphOrdinal ?? 0) + 1,
      })
    if (diagnostic.code.startsWith("font-")) return t("fontFailed")
    if (diagnostic.code === "empty-text-outline") return t("emptyOutline")
    if (diagnostic.code === "outline-budget-exceeded") return t("outlineBudget")
    return t("outlineFailed")
  }
  const state = useSketchTextTask({
    target,
    getDraft,
    onDraftChange,
    onApplied: onClose,
    copy: {
      stale: t("draftChanged"),
      constraints: t("constraintsRequired"),
      fontFailed: t("fontFailed"),
      outlineFailed: t("outlineFailed"),
      outlineProblem: problem,
      fieldProblem: (key) => t(key),
    },
  })
  const { form } = state
  return (
    <Form
      form={form}
      aria-label={t(target.group ? "editTitle" : "title")}
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <DialogBody>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <fieldset disabled={pending} aria-busy={pending} className="grid gap-4">
              <legend className="sr-only">{t("parameters")}</legend>
              <form.AppField name="text">
                {(field) => <field.TextField label={t("text")} required />}
              </form.AppField>
              <TextDimensions form={form} />
              <TextAlignment form={form} />
              <form.AppField name="kerning">
                {(field) => <field.CheckboxField label={t("kerning")} />}
              </form.AppField>
              <TextRegenerationNotice state={state} />
            </fieldset>
          )}
        </form.Subscribe>
        <form.FormError />
        {state.error && <Alert>{state.error}</Alert>}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <form.SubmitButton requireDirty={false} disabled={state.altered === null}>
          {t("apply")}
        </form.SubmitButton>
      </DialogFooter>
    </Form>
  )
}
export function SketchTextDialog({
  target,
  getDraft,
  onDraftChange,
  onClose,
}: {
  target: SketchTextTarget | null
  getDraft: () => SketchRecord | null
  onDraftChange: (draft: SketchRecord) => void
  onClose: () => void
}) {
  const t = useTranslations("app.sketchText")
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl" closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t(target?.group ? "editTitle" : "title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {target && (
          <TextTask
            key={target.group?.id ?? target.sketch.id}
            target={target}
            getDraft={getDraft}
            onDraftChange={onDraftChange}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
