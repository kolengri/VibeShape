import type { VariableId } from "@vibeshape/domain/identifiers"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { DialogBody, DialogFooter } from "@vibeshape/ui/components/dialog"
import { InformationIcon } from "@vibeshape/ui/components/icons"
import { type ReactNode, useState } from "react"
import {
  applyVariableTable,
  createBrowserVariableId,
  type DocumentControllerState,
  renameVariable,
} from "../../document/document-controller"
import { VariableUsageInspector } from "./variable-usage-inspector"
import { referencedModelVariableNames, VariablesForm } from "./variables-form"

type VariablesPanelProps = { controller: DocumentControllerState; closeAction: ReactNode }

function VariablesPanelMessage({
  kind,
  status,
  closeAction,
}: {
  closeAction: ReactNode
  kind: "error" | "loading"
  status: DocumentControllerState["status"]
}) {
  const t = useTranslations("app.variables")
  const isError = kind === "error"
  useReportActivity(!isError)

  return (
    <>
      <DialogBody data-document-status={status}>
        {isError ? (
          <Alert className="mt-2">{t("loadFailed")}</Alert>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {t("loading")}
          </p>
        )}
      </DialogBody>
      <DialogFooter>{closeAction}</DialogFooter>
    </>
  )
}

function ReadyVariablesPanel({
  report,
  closeAction,
  inspectionAvailable,
}: {
  closeAction: ReactNode
  report: NonNullable<DocumentControllerState["report"]>
  inspectionAvailable: boolean
}) {
  const t = useTranslations("app.variables")
  const snapshot = report.snapshot
  const [inspectedId, setInspectedId] = useState<VariableId | null>(null)
  const inspectedVariable = snapshot.variables.find(({ id }) => id === inspectedId)
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
    noMatches: t("table.noMatches"),
    add: t("actions.add"),
    remove: t("actions.remove"),
    rename: t("actions.rename"),
    confirmRename: t("actions.confirmRename"),
    cancelRename: t("actions.cancelRename"),
    nameInput: t("fields.name"),
    expressionInput: t("fields.expression"),
    search: t("fields.search"),
    searchPlaceholder: t("fields.searchPlaceholder"),
    clearSearch: t("actions.clearSearch"),
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
      dialogCloseAction={closeAction}
      inspection={{
        rowActions: new Map(
          snapshot.variables.map((variable) => [
            variable.id,
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={t("usage.action", { name: variable.name })}
              title={t("usage.action", { name: variable.name })}
              aria-expanded={inspectedId === variable.id}
              data-variable-usage-id={variable.id}
              onClick={() => setInspectedId(variable.id)}
            >
              <InformationIcon aria-hidden="true" />
            </Button>,
          ]),
        ),
        details: inspectedVariable ? (
          <VariableUsageInspector
            key={`${snapshot.id}:${snapshot.revision}:${inspectedVariable.id}:${inspectionAvailable}`}
            snapshot={inspectionAvailable ? snapshot : null}
            variableId={inspectedVariable.id}
            name={inspectedVariable.name}
            onClose={(event) => {
              const form = event.currentTarget.form
              const trigger = form?.querySelector<HTMLButtonElement>(
                `[data-variable-usage-id="${inspectedVariable.id}"]`,
              )
              const destination =
                trigger && !trigger.closest("[hidden]")
                  ? trigger
                  : form?.querySelector<HTMLInputElement>('input[type="search"]')
              setInspectedId(null)
              destination?.focus()
            }}
          />
        ) : null,
      }}
    />
  )
}

function LoadingVariablesPanel({ controller, closeAction }: VariablesPanelProps) {
  return (
    <VariablesPanelMessage kind="loading" status={controller.status} closeAction={closeAction} />
  )
}

function ErrorVariablesPanel({ controller, closeAction }: VariablesPanelProps) {
  return <VariablesPanelMessage kind="error" status={controller.status} closeAction={closeAction} />
}

function ResolvedVariablesPanel({ controller, closeAction }: VariablesPanelProps) {
  return controller.report ? (
    <ReadyVariablesPanel
      report={controller.report}
      closeAction={closeAction}
      inspectionAvailable={controller.status === "ready" && controller.saveStatus !== "saving"}
    />
  ) : (
    <VariablesPanelMessage kind="error" status={controller.status} closeAction={closeAction} />
  )
}

const panelByStatus = {
  idle: LoadingVariablesPanel,
  loading: LoadingVariablesPanel,
  library: ({ closeAction }) => <DialogFooter>{closeAction}</DialogFooter>,
  ready: ResolvedVariablesPanel,
  error: ErrorVariablesPanel,
} satisfies Record<DocumentControllerState["status"], (props: VariablesPanelProps) => ReactNode>

export function VariablesPanel({ controller, closeAction }: VariablesPanelProps) {
  const Panel = panelByStatus[controller.status]
  return <Panel controller={controller} closeAction={closeAction} />
}
