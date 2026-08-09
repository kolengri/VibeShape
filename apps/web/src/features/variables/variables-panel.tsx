import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  applyVariableTable,
  createBrowserVariableId,
  type DocumentControllerState,
  renameVariable,
} from "../../document/document-controller"
import { referencedModelVariableNames, VariablesForm } from "./variables-form"

type VariablesPanelProps = { controller: DocumentControllerState }

function VariablesPanelMessage({
  kind,
  status,
}: {
  kind: "error" | "loading"
  status: DocumentControllerState["status"]
}) {
  const t = useTranslations("app.variables")
  const isError = kind === "error"

  return (
    <section
      className="min-h-0 overflow-auto bg-background p-4"
      aria-labelledby="variables-title"
      data-document-status={status}
    >
      <h1 id="variables-title" className="text-base font-semibold">
        {t("title")}
      </h1>
      <p
        className={isError ? "mt-2 text-sm text-destructive" : "mt-2 text-sm text-muted-foreground"}
        role={isError ? "alert" : "status"}
      >
        {t(isError ? "loadFailed" : "loading")}
      </p>
    </section>
  )
}

function ReadyVariablesPanel({
  report,
}: {
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.variables")
  const snapshot = report.snapshot
  const protectedNames = referencedModelVariableNames(snapshot.variables, [
    ...snapshot.features.map(({ parameters }) => parameters),
    ...snapshot.sketches.map(({ constraints }) => constraints),
  ])
  const copy = {
    caption: t("table.caption"),
    name: t("table.name"),
    expression: t("table.expression"),
    result: t("table.result"),
    status: t("table.status"),
    actions: t("table.actions"),
    empty: t("table.empty"),
    add: t("actions.add"),
    remove: t("actions.remove"),
    rename: t("actions.rename"),
    confirmRename: t("actions.confirmRename"),
    cancelRename: t("actions.cancelRename"),
    nameInput: t("fields.name"),
    expressionInput: t("fields.expression"),
    valid: t("states.valid"),
    invalid: t("states.invalid"),
    pending: t("states.pending"),
    apply: t("actions.apply"),
    readOnly: t("messages.readOnly"),
    validationSummary: t("messages.validationSummary"),
    staleRevision: t("messages.staleRevision"),
    applyFailed: t("messages.applyFailed"),
    removeInUse: t("messages.removeInUse"),
    invalidName: t("messages.invalidName"),
    invalidExpression: t("messages.invalidExpression"),
    renameNoChange: t("messages.renameNoChange"),
    renameConflict: t("messages.renameConflict"),
    renameFailed: t("messages.renameFailed"),
  }

  return (
    <section className="min-h-0 overflow-auto bg-background p-4" aria-labelledby="variables-title">
      <div className="mx-auto grid max-w-6xl gap-4">
        <div>
          <h1 id="variables-title" className="text-base font-semibold">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <VariablesForm
          key={snapshot.revision}
          baseRevision={snapshot.revision}
          variables={snapshot.variables}
          copy={copy}
          createVariableId={createBrowserVariableId}
          disabled={report.mode === "read-only"}
          protectedVariableNames={protectedNames}
          onApply={applyVariableTable}
          onRename={renameVariable}
        />
      </div>
    </section>
  )
}

function LoadingVariablesPanel({ controller }: VariablesPanelProps) {
  return <VariablesPanelMessage kind="loading" status={controller.status} />
}

function ErrorVariablesPanel({ controller }: VariablesPanelProps) {
  return <VariablesPanelMessage kind="error" status={controller.status} />
}

function ResolvedVariablesPanel({ controller }: VariablesPanelProps) {
  return controller.report ? (
    <ReadyVariablesPanel report={controller.report} />
  ) : (
    <VariablesPanelMessage kind="error" status={controller.status} />
  )
}

const panelByStatus = {
  idle: LoadingVariablesPanel,
  loading: LoadingVariablesPanel,
  ready: ResolvedVariablesPanel,
  error: ErrorVariablesPanel,
} satisfies Record<DocumentControllerState["status"], (props: VariablesPanelProps) => ReactNode>

export function VariablesPanel({ controller }: VariablesPanelProps) {
  const Panel = panelByStatus[controller.status]
  return <Panel controller={controller} />
}
