import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { createContext, type ReactNode, useContext, useId, useState } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { exactSolidBodyOptions } from "../features/part-design/exact-body-options"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import { currentAuthoredParts, currentAuthoredSnapshot } from "./authored-tree-state"
import {
  type HistoryFeatureBodyReplacement,
  missingHistoryFeatureBody,
  replaceHistoryFeatureBody,
} from "./history-feature-body-repair"
import { historyFeatureForEditing, historyRepairTaskContext } from "./history-repair-context"

const replacementContext = createContext<HistoryFeatureBodyReplacement | null>(null)

export function useHistoryFeatureBodyReplacement(featureId: FeatureId | undefined) {
  const replacement = useContext(replacementContext)
  return replacement?.feature.id === featureId ? replacement : null
}

type Props = {
  controller: DocumentControllerState
  tool: ActivePartDesignTool | null
  onClose: () => void
  renderDelete: (feature: FeatureRecord) => ReactNode
  children: (controller: DocumentControllerState) => ReactNode
}

function retainedFeatureRepairIntent(controller: DocumentControllerState, featureId: FeatureId) {
  const authority = currentAuthoredSnapshot(controller)
  if (authority?.schemaVersion !== 5) return undefined
  return authority.repairIntents.find(
    (item) => item.kind === "feature" && item.authored.id === featureId,
  )
}

function retainedFeatureBodyTask(controller: DocumentControllerState, tool: Props["tool"]) {
  if (!tool || !("featureId" in tool) || !tool.featureId) return null
  const intent = retainedFeatureRepairIntent(controller, tool.featureId)
  if (intent?.kind !== "feature") return null
  const feature = historyFeatureForEditing(controller, tool.featureId)
  if (!feature || !missingHistoryFeatureBody(feature, intent.missingInputs)) return null
  return { feature, intent }
}

function replacementTaskContext(controller: DocumentControllerState, feature: FeatureRecord) {
  const report = controller.report
  if (!report) return controller
  return {
    ...controller,
    report: {
      ...report,
      snapshot: {
        ...report.snapshot,
        features: report.snapshot.features.map((item) => (item.id === feature.id ? feature : item)),
      },
    },
  }
}

export function HistoryFeatureRepair({ controller, tool, onClose, renderDelete, children }: Props) {
  const t = useTranslations("app.historyFeatureRepair")
  const [selectedBodyId, setSelectedBodyId] = useState("")
  const selectId = useId()
  const task = retainedFeatureBodyTask(controller, tool)
  const formController = historyRepairTaskContext(controller, tool)
  const report = controller.report
  if (!task || !report) return children(formController)
  const { feature, intent } = task
  const options = exactSolidBodyOptions(
    report.snapshot,
    report.rebuild,
    feature.id,
    currentAuthoredParts(controller),
    t("unnamedBody"),
  ).flatMap((option) => (option.body ? [{ ...option, body: option.body }] : []))
  const selected = options.find(({ id }) => id === selectedBodyId)
  const replacement = selected
    ? replaceHistoryFeatureBody(feature, intent.missingInputs, selected.body)
    : null
  const adaptedController = replacement
    ? replacementTaskContext(formController, replacement.feature)
    : formController
  return (
    <div className="flex min-h-0 flex-col border-l bg-panel">
      <section aria-label={t("title")} className="grid shrink-0 gap-2 border-b p-4">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p id={`${selectId}-description`} className="text-xs leading-4 text-muted-foreground">
          {t("description")}
        </p>
        <label htmlFor={selectId} className="grid gap-1 text-sm">
          {t("replacementBody")}
          <select
            id={selectId}
            aria-describedby={`${selectId}-description`}
            className="h-9 min-w-0 rounded-md border bg-background px-2"
            value={selected?.id ?? ""}
            disabled={
              controller.status !== "ready" ||
              controller.saveStatus === "saving" ||
              report.mode === "read-only"
            }
            onChange={(event) => setSelectedBodyId(event.target.value)}
          >
            <option value="">{t("chooseBody")}</option>
            {options.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {options.length === 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("noBodies")}
          </p>
        )}
        {replacement?.shellClosed === false && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("reselectOpenings")}
          </p>
        )}
        {!replacement && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            {renderDelete(feature)}
          </>
        )}
      </section>
      {replacement && (
        <replacementContext.Provider key={selectedBodyId} value={replacement}>
          {children(adaptedController)}
        </replacementContext.Provider>
      )}
    </div>
  )
}
