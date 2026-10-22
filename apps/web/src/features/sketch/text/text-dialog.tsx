import type { SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { TextField } from "@vibeshape/ui/components/text-field"
import { cn } from "@vibeshape/ui/lib/cn"
import type { SketchTextOutlineError } from "./text-model"
import { type SketchTextTarget, type SketchTextTask, useSketchTextTask } from "./use-sketch-text"

function TextDimensions({ state }: { state: SketchTextTask }) {
  const t = useTranslations("app.sketchText")
  return (
    <div className="grid gap-2">
      {(["height", "tracking", "originX", "originY"] as const).map((field) => {
        const error = state.fieldErrors[field]
        return (
          <TextField
            key={field}
            label={t(field)}
            type="number"
            step="any"
            required
            value={state.values[field]}
            error={error ? t(error) : undefined}
            onChange={(event) => state.update(field, event.currentTarget.value)}
          />
        )
      })}
    </div>
  )
}
function TextAlignment({ state }: { state: SketchTextTask }) {
  const t = useTranslations("app.sketchText")
  return (
    <div className="grid gap-2">
      <SelectField
        label={t("horizontal")}
        value={state.values.horizontal}
        onValueChange={(value) => {
          if (value === "left" || value === "center" || value === "right")
            state.update("horizontal", value)
        }}
      >
        {(["left", "center", "right"] as const).map((value) => (
          <SelectOption key={value} value={value}>
            {t(value)}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("vertical")}
        value={state.values.vertical}
        onValueChange={(value) => {
          if (value === "baseline" || value === "bottom" || value === "center" || value === "top")
            state.update("vertical", value)
        }}
      >
        {(["baseline", "bottom", "center", "top"] as const).map((value) => (
          <SelectOption key={value} value={value}>
            {t(value)}
          </SelectOption>
        ))}
      </SelectField>
    </div>
  )
}
function TextRegenerationNotice({ state }: { state: SketchTextTask }) {
  const t = useTranslations("app.sketchText")
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
          <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
            <span>{t("removeConstraints")}</span>
            <input
              type="checkbox"
              className="accent-primary"
              checked={state.values.removeAttachedConstraints}
              onChange={(event) =>
                state.update("removeAttachedConstraints", event.currentTarget.checked)
              }
            />
          </label>
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
    },
  })
  const textError = state.fieldErrors.text
  return (
    <form
      aria-label={t(target.group ? "editTitle" : "title")}
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void state.apply()
      }}
    >
      <fieldset disabled={state.pending} aria-busy={state.pending} className="grid gap-4">
        <legend className="sr-only">{t("parameters")}</legend>
        <TextField
          label={t("text")}
          value={state.values.text}
          required
          error={textError ? t(textError) : undefined}
          onChange={(event) => state.update("text", event.currentTarget.value)}
        />
        <TextDimensions state={state} />
        <TextAlignment state={state} />
        <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
          <span>{t("kerning")}</span>
          <input
            type="checkbox"
            className="accent-primary"
            checked={state.values.kerning}
            onChange={(event) => state.update("kerning", event.currentTarget.checked)}
          />
        </label>
        <TextRegenerationNotice state={state} />
      </fieldset>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          isLoading={state.pending}
          disabled={state.pending || state.altered === null}
        >
          {t("apply")}
        </Button>
      </DialogFooter>
    </form>
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
