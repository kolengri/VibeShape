import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { createContext, type ReactNode, useContext, useId, useMemo, useState } from "react"
import { TaskPanelContentProvider, TaskPanelLayout } from "../components/task-panel-layout"
import { TaskPanelLifecycleActions } from "../components/task-panel-lifecycle-actions"
import type { DocumentControllerState } from "../document/document-controller"
import { useExactSolidBodyOptions } from "../features/part-design/exact-body-options"
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
  if (authority?.schemaVersion !== 5 && authority?.schemaVersion !== 6) return undefined
  return authority.repairIntents.find(
    (item) => item.kind === "feature" && item.authored.id === featureId,
  )
}

function retainedFeatureBodyTask(controller: DocumentControllerState, featureId?: FeatureId) {
  if (!featureId) return null
  const intent = retainedFeatureRepairIntent(controller, featureId)
  if (intent?.kind !== "feature") return null
  const feature = historyFeatureForEditing(controller, featureId)
  if (!feature || !missingHistoryFeatureBody(feature, intent.missingInputs)) return null
  return { feature, intent }
}

/** Which saved topology the user must pick again on the replacement body, if any. */
function reselectedInput(replacement: HistoryFeatureBodyReplacement | null) {
  if (replacement?.shellClosed === false) return "openings"
  return replacement?.faceTarget ? "faces" : null
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
  // Both derivations parse and spread fresh records. Children key effects and memoized evidence
  // on report identity, so a new object on every render would re-run them in a loop.
  const featureId = tool && "featureId" in tool ? tool.featureId : undefined
  const task = useMemo(
    () => retainedFeatureBodyTask(controller, featureId),
    [controller, featureId],
  )
  const formController = useMemo(
    () => historyRepairTaskContext(controller, featureId),
    [controller, featureId],
  )
  const report = controller.report
  const hasRepairTask = task !== null
  const parts = useMemo(
    () => (hasRepairTask ? currentAuthoredParts(controller) : []),
    [controller.authoredSnapshot, report, hasRepairTask],
  )
  const bodyOptions = useExactSolidBodyOptions(
    report?.snapshot,
    report?.rebuild,
    task?.feature.id,
    parts,
    t("unnamedBody"),
    undefined,
    hasRepairTask,
  )
  const options = useMemo(
    () => bodyOptions.flatMap((option) => (option.body ? [{ ...option, body: option.body }] : [])),
    [bodyOptions],
  )
  const selected = options.find(({ id }) => id === selectedBodyId)
  const selectedBody = selected?.body
  const repair = useMemo(() => {
    const replacement =
      task && selectedBody
        ? replaceHistoryFeatureBody(task.feature, task.intent.missingInputs, selectedBody)
        : null
    return replacement
      ? { replacement, controller: replacementTaskContext(formController, replacement.feature) }
      : null
  }, [formController, selectedBody, task])
  if (!task || !report) return children(formController)
  const { feature } = task
  const replacement = repair?.replacement ?? null
  const adaptedController = repair?.controller ?? formController
  const controls = (
    <RepairBodyControls
      t={t}
      selectId={selectId}
      options={options}
      selectedId={selected?.id ?? ""}
      disabled={
        controller.status !== "ready" ||
        controller.saveStatus === "saving" ||
        report.mode === "read-only"
      }
      onSelect={setSelectedBodyId}
      reselect={reselectedInput(replacement)}
    />
  )
  if (replacement)
    return (
      <TaskPanelContentProvider
        content={
          <>
            <p id={`${selectId}-description`} className="text-xs text-muted-foreground">
              {t("description")}
            </p>
            {controls}
          </>
        }
      >
        <replacementContext.Provider key={selectedBodyId} value={replacement}>
          {children(adaptedController)}
        </replacementContext.Provider>
      </TaskPanelContentProvider>
    )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l bg-panel">
      <section aria-label={t("title")} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TaskPanelLayout
          title={t("title")}
          instruction={<span id={`${selectId}-description`}>{t("description")}</span>}
          actions={
            <TaskPanelLifecycleActions
              ariaLabel={t("title")}
              cancelLabel={t("cancel")}
              onCancel={onClose}
            />
          }
        >
          {controls}
          {renderDelete(feature)}
        </TaskPanelLayout>
      </section>
    </div>
  )
}

function RepairBodyControls({
  t,
  selectId,
  options,
  selectedId,
  disabled,
  onSelect,
  reselect,
}: {
  t: ReturnType<typeof useTranslations>
  selectId: string
  options: readonly { id: string; label: string }[]
  selectedId: string
  disabled: boolean
  onSelect: (id: string) => void
  reselect: "openings" | "faces" | null
}) {
  return (
    <>
      <label htmlFor={selectId} className={fieldVariants({ orientation: "horizontal" })}>
        {t("replacementBody")}
        <NativeSelect
          id={selectId}
          aria-describedby={`${selectId}-description`}
          value={selectedId}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">{t("chooseBody")}</option>
          {options.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      {options.length === 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("noBodies")}
        </p>
      )}
      {reselect && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(reselect === "openings" ? "reselectOpenings" : "reselectFaces")}
        </p>
      )}
    </>
  )
}
