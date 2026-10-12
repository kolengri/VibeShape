import type { AutomationDraftPreview } from "@vibeshape/automation-api/drafts"
import type { AssemblyReviewInput } from "@vibeshape/automation-host/assembly-session-contract"
import type { HistoryReviewInput } from "@vibeshape/automation-host/history-session"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import type { SurfaceTextureReviewInput } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import type { CommandActor, DocumentCommand } from "@vibeshape/domain/commands"
import { quantitySchema } from "@vibeshape/domain/units"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { TaskPanelHeader } from "../components/task-panel-header"
import { useSurfaceTexturePreviewContext } from "../features/surface-texture/surface-texture-preview-context"
import { AssemblyAutomationReviewPanel } from "./assembly-review-panel"
import { isDestructiveCommand, ReviewActions } from "./automation-review-actions"
import type { AutomationReviewState } from "./automation-review-state"
import { isImportReview, isPlanarImportReview } from "./automation-review-state"
import { HistoryAutomationReviewPanel } from "./history-review-panel"
import { ImportReviewPanel } from "./import-review-panel"
import { PlanarImportReviewPanel } from "./planar-import-review-panel"
import { SurfaceTextureReviewPanel } from "./surface-texture-review-panel"

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

function ReviewDiagnostic({ review }: { review: AutomationReviewState }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  if (review.status !== "error") return null
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
    <p className="mb-3 text-sm text-destructive" role="status">
      {t(diagnosticMessage)}
    </p>
  )
}

function MetadataDetails({ metadata }: { metadata: NonNullable<DraftReviewInput["metadata"]> }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const { change, targetName, range } = metadata
  const labels = {
    "part.rename": "renamePart",
    "part.set-visibility": "setPartVisibility",
    "folder.create": "createFolder",
    "folder.rename": "renameFolder",
    "folder.set-items": "setFolderItems",
    "folder.remove": "removeFolder",
  } as const
  return (
    <li className="break-words rounded border p-2">
      <div className="font-medium">{t(labels[change.kind])}</div>
      {targetName ? <div>{t("target", { target: targetName })}</div> : null}
      {"name" in change ? <div>{t("nameValue", { name: change.name })}</div> : null}
      {change.kind === "folder.create" ? (
        <div>{t("nameValue", { name: change.folder.name })}</div>
      ) : null}
      {change.kind === "part.set-visibility" ? (
        <div>{t(change.visible ? "showPart" : "hidePart")}</div>
      ) : null}
      {range ? (
        <div>
          {t("folderRange", { first: range.firstLabel, last: range.lastLabel, count: range.count })}
        </div>
      ) : null}
      {change.kind === "folder.remove" ? <div>{t("ungroupPreservesFeatures")}</div> : null}
    </li>
  )
}

export function AutomationReviewPanel({ review }: { review: AutomationReviewState }) {
  if (isPlanarImportReview(review.input))
    return <PlanarImportReviewPanel key={review.id} review={{ ...review, input: review.input }} />
  if (isImportReview(review.input))
    return <ImportReviewPanel key={review.id} review={{ ...review, input: review.input }} />
  if ("kind" in review.input && review.input.kind === "surface-texture")
    return <SurfaceTextureProposalReview review={{ ...review, input: review.input }} />
  return <CadReviewPanel review={{ ...review, input: review.input }} />
}

function SurfaceTextureProposalReview({
  review,
}: {
  review: Omit<AutomationReviewState, "input"> & { input: SurfaceTextureReviewInput }
}) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const texture = useSurfaceTexturePreviewContext()
  const { input } = review
  return (
    <SurfaceTextureReviewPanel
      input={input}
      client={actorLabel(input.actor, t)}
      diagnostic={<ReviewDiagnostic review={review} />}
      previewStatus={texture?.status ?? "loading"}
      actions={
        <ReviewActions
          commands={[]}
          review={review}
          t={t}
          destructive={input.operation === "remove"}
          ready={
            !input.command.payload.layers.some((layer) => layer.enabled) ||
            Boolean(
              texture?.draft &&
                texture.draft.documentId === input.command.documentId &&
                texture.draft.revision === input.draft.baseRevision &&
                texture.readyDraft === texture.draft &&
                texture.status === "ready",
            )
          }
        />
      }
    />
  )
}

function CadReviewPanel({
  review,
}: {
  review: Omit<AutomationReviewState, "input"> & {
    input: DraftReviewInput | AssemblyReviewInput | HistoryReviewInput
  }
}) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const { input } = review
  if ("kind" in input && input.kind === "history")
    return (
      <HistoryAutomationReviewPanel
        input={input}
        client={actorLabel(input.actor, t)}
        diagnostic={<ReviewDiagnostic review={review} />}
        actions={<ReviewActions commands={[]} review={review} t={t} destructive={false} />}
      />
    )
  if ("kind" in input)
    return (
      <AssemblyAutomationReviewPanel
        input={input}
        client={actorLabel(input.actor, t)}
        diagnostic={<ReviewDiagnostic review={review} />}
        actions={
          <ReviewActions
            commands={[]}
            review={review}
            t={t}
            destructive={input.changes.some(
              (change) =>
                change.kind === "definition.remove" ||
                change.kind === "instance.remove" ||
                change.kind === "joint.remove",
            )}
          />
        }
      />
    )
  const commands = input.commands
  return (
    <section
      aria-label={t("title")}
      className="grid h-full max-h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l bg-panel"
    >
      <TaskPanelHeader
        title={t("title")}
        className="border-b p-4"
        actions={<ReviewActions commands={commands} review={review} t={t} />}
      />
      <section
        key={review.status === "error" ? "error" : "proposal"}
        aria-label={t("changes")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The labelled scroll region needs keyboard access to long proposals.
        tabIndex={0}
        className="min-h-0 min-w-0 overflow-auto overscroll-contain p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ReviewDiagnostic review={review} />
        <p className="text-xs text-muted-foreground">{t("description")}</p>
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
            {input.metadata ? <MetadataDetails metadata={input.metadata} /> : null}
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
      </section>
    </section>
  )
}
