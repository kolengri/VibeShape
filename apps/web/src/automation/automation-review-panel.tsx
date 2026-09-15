import type { AutomationDraftPreview } from "@vibeshape/automation-api/drafts"
import type { CommandActor, DocumentCommand } from "@vibeshape/domain/commands"
import { documentCoreModule, featureCoreModule } from "@vibeshape/domain/modules"
import { quantitySchema } from "@vibeshape/domain/units"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import { automationReviews } from "./automation-review-controller"
import type { AutomationReviewState } from "./automation-review-state"

const commandLabels: Readonly<Record<DocumentCommand["kind"], string>> = {
  "org.vibeshape.document.create": "createDocument",
  "org.vibeshape.document.rename": "renameDocument",
  "org.vibeshape.document.set-display-units": "setDisplayUnits",
  "org.vibeshape.variable.add": "addVariable",
  "org.vibeshape.variable.set-expression": "setVariableExpression",
  "org.vibeshape.variable.rename": "renameVariable",
  "org.vibeshape.variable.remove": "removeVariable",
  "org.vibeshape.variable.replace-table": "replaceVariableTable",
  "org.vibeshape.sketch.add": "addSketch",
  "org.vibeshape.sketch.update": "updateSketch",
  "org.vibeshape.sketch.remove": "removeSketch",
  "org.vibeshape.feature.add": "addFeature",
  "org.vibeshape.feature.update": "updateFeature",
  "org.vibeshape.feature.remove": "removeFeature",
  "org.vibeshape.feature.remove-preserving-model-reference-intent":
    "removeFeaturePreservingReferences",
  "org.vibeshape.feature.set-suppressed": "setFeatureSuppression",
}

function isDestructiveCommand(command: DocumentCommand) {
  const descriptor = [...documentCoreModule.commands, ...featureCoreModule.commands].find(
    (candidate) =>
      candidate.kind === command.kind && candidate.schemaVersion === command.schemaVersion,
  )
  return descriptor?.automation.destructive === true || descriptor?.confirmation === "destructive"
}

function actorLabel(actor: CommandActor, t: ReturnType<typeof useTranslations>) {
  if (actor.type === "mcp") return t("actorMcp", { clientId: actor.clientId })
  if (actor.type === "extension") return t("actorExtension", { extensionId: actor.extensionId })
  return actor.type === "user" ? t("actorUser") : t("actorSystem")
}

function commandTarget(command: DocumentCommand, fallback: string) {
  const payload = command.payload
  if ("feature" in payload) return payload.feature.label ?? payload.feature.id
  if ("sketch" in payload) return payload.sketch.label
  if ("variable" in payload) return payload.variable.name
  if ("featureId" in payload) return payload.featureId
  if ("sketchId" in payload) return payload.sketchId
  if ("variableId" in payload) return payload.variableId
  return fallback
}

const featureParameterLabels = {
  width: "width",
  depth: "depth",
  height: "height",
  radius: "radius",
  distance: "distance",
  angle: "angle",
} as const

function FeatureDimensions({ parameters }: { parameters: Record<string, unknown> }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const formatter = useFormatter()
  return (
    <dl className="grid gap-1">
      {Object.entries(featureParameterLabels).map(([key, label]) => {
        const value = parameters[key]
        const quantity = quantitySchema.safeParse(value)
        const formatted = quantity.success
          ? t("quantity", {
              value: formatter.number(quantity.data.source.value),
              unit: quantity.data.source.unit,
            })
          : typeof value === "string"
            ? value
            : null
        return formatted === null ? null : (
          <div key={key} className="flex flex-wrap justify-between gap-2">
            <dt>{t(label)}</dt>
            <dd>{formatted}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function VariableDetails({ command }: { command: DocumentCommand }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const payload = command.payload
  if ("variables" in payload)
    return (
      <ul>
        {payload.variables.map((variable) => (
          <li key={variable.id}>
            {t("variableValue", { name: variable.name, expression: variable.expression })}
          </li>
        ))}
      </ul>
    )
  if ("variable" in payload)
    return (
      <p>
        {t("variableValue", {
          name: payload.variable.name,
          expression: payload.variable.expression,
        })}
      </p>
    )
  if ("expression" in payload)
    return <p>{t("expressionValue", { expression: payload.expression })}</p>
  if ("name" in payload) return <p>{t("nameValue", { name: payload.name })}</p>
  return null
}

function CommandDetails({ command }: { command: DocumentCommand }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const payload = command.payload
  if ("feature" in payload) return <FeatureDimensions parameters={payload.feature.parameters} />
  if ("sketch" in payload)
    return (
      <p>
        {t("sketchContents", {
          entities: payload.sketch.entities.length,
          constraints: payload.sketch.constraints.length,
        })}
      </p>
    )
  if (command.kind.startsWith("org.vibeshape.variable."))
    return <VariableDetails command={command} />
  if ("name" in payload) return <p>{t("nameValue", { name: payload.name })}</p>
  if ("displayUnits" in payload)
    return (
      <p>
        {t("unitsValue", {
          length: payload.displayUnits.length,
          angle: payload.displayUnits.angle,
        })}
      </p>
    )
  if ("suppressed" in payload)
    return <p>{t(payload.suppressed ? "suppressFeature" : "restoreFeature")}</p>
  return null
}

function Measurements({ preview }: { preview: AutomationDraftPreview }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const formatter = useFormatter()
  const view = preview.geometry.measurements
  const succeeded = view.data.features.filter((entry) => entry.status === "succeeded")
  const unit = view.units.length
  return (
    <section className="mt-4 border-t pt-3" aria-label={t("measurements")}>
      <h3 className="text-xs font-medium">{t("measurements")}</h3>
      {succeeded.map((entry) => {
        const { bounds, surfaceArea, volume } = entry.shape
        const number = (value: number) => formatter.number(value, { maximumFractionDigits: 4 })
        return (
          <dl key={entry.featureId} className="mt-2 grid gap-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt>{entry.label ?? t("unnamedOutput")}</dt>
              <dd />
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("volume")}</dt>
              <dd className="font-mono">{number(volume)} mm³</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("bounds")}</dt>
              <dd className="font-mono">
                {number(bounds.max[0] - bounds.min[0])} × {number(bounds.max[1] - bounds.min[1])} ×{" "}
                {number(bounds.max[2] - bounds.min[2])} {unit}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("surfaceArea")}</dt>
              <dd className="font-mono">{number(surfaceArea)} mm²</dd>
            </div>
          </dl>
        )
      })}
      {view.data.total > view.data.features.length || view.nextCursor ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("limitedMeasurements", { shown: view.data.features.length, total: view.data.total })}
        </p>
      ) : null}
    </section>
  )
}

function ReviewActions({
  commands,
  review,
  t,
}: {
  commands: readonly DocumentCommand[]
  review: AutomationReviewState
  t: ReturnType<typeof useTranslations>
}) {
  const destructive = commands.some(isDestructiveCommand)
  const apply = async () => {
    await automationReviews.decide(review.id, "approved")
  }
  const discard = () => automationReviews.decide(review.id, "rejected")
  if (review.status === "error") {
    const messages: Partial<Record<NonNullable<AutomationReviewState["diagnostic"]>, string>> = {
      "draft-expired": "expired",
      "stale-revision": "stale",
      "draft-review-cancelled": "cancelled",
      "document-write-unavailable": "writeUnavailable",
      "document-commit-failed": "unconfirmed",
    }
    const diagnosticMessage = review.diagnostic
      ? (messages[review.diagnostic] ?? "applyFailed")
      : "applyFailed"
    return (
      <>
        <p className="mt-3 text-sm text-destructive" role="status">
          {t(diagnosticMessage)}
        </p>
        <div className="mt-5 flex justify-end border-t pt-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => automationReviews.dismiss(review.id)}
          >
            {t("close")}
          </Button>
        </div>
      </>
    )
  }
  return (
    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-3">
      <Button
        variant="outline"
        type="button"
        disabled={review.status !== "ready"}
        onClick={discard}
      >
        {t("discard")}
      </Button>
      {destructive ? (
        <DestructiveApply
          disabled={review.status !== "ready"}
          isLoading={review.status === "applying"}
          onApply={apply}
          label={t("apply")}
          t={t}
        />
      ) : (
        <Button
          type="button"
          disabled={review.status !== "ready"}
          isLoading={review.status === "applying"}
          onClick={apply}
        >
          {t("apply")}
        </Button>
      )}
    </div>
  )
}

function DestructiveApply({
  disabled,
  isLoading,
  onApply,
  label,
  t,
}: {
  disabled: boolean
  isLoading: boolean
  onApply: () => Promise<void>
  label: string
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" type="button" disabled={disabled} isLoading={isLoading}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("destructiveTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("destructiveDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            type="button"
            disabled={disabled}
            isLoading={isLoading}
            onClick={onApply}
          >
            {t("confirmApply")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function AutomationReviewPanel({ review }: { review: AutomationReviewState }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const { input } = review
  const commands = input.commands
  return (
    <section aria-label={t("title")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{t("title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt>{t("client")}</dt>
          <dd className="min-w-0 break-all">{actorLabel(input.actor, t)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t("document")}</dt>
          <dd className="min-w-0 break-words">{input.preview.summary.data.name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t("baseRevision")}</dt>
          <dd className="font-mono">{input.preview.draft.baseRevision}</dd>
        </div>
      </dl>
      <section className="mt-4 border-t pt-3">
        <h3 className="text-xs font-medium">{t("changes")}</h3>
        <ul className="mt-2 grid gap-2 text-xs">
          {commands.map((command) => (
            <li key={command.commandId} className="break-words rounded border p-2">
              <div className="font-medium">
                {t(commandLabels[command.kind] ?? "unknownCommand")}
              </div>
              <div className="text-muted-foreground">
                {t("target", { target: commandTarget(command, t("documentTarget")) })}
              </div>
              <div className="text-muted-foreground">
                <CommandDetails command={command} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Measurements preview={input.preview} />
      {commands.some(isDestructiveCommand) ? (
        <p className="mt-4 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {t("destructiveWarning")}
        </p>
      ) : null}
      <ReviewActions commands={commands} review={review} t={t} />
    </section>
  )
}
