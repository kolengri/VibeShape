import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { inspectTopologyMeasurements } from "@vibeshape/application/model-topology-measurements"
import { readConnectMountsFeatureParameters } from "@vibeshape/domain/part-design-connect-mounts"
import { useTranslations } from "@vibeshape/i18n"
import { useMemo } from "react"
import { TaskPanelSurface } from "../../components/task-panel-layout"
import { createBrowserFeatureId } from "../../document/document-controller"
import type { BodyFeatureTaskPanelProps } from "../../shell/body-feature-task-mode"
import { featureTaskFormProps, featureTaskKey } from "../../shell/feature-task-form-props"
import { useExactSolidBodyOptions } from "../part-design/exact-body-options"
import { ConnectMountsForm } from "./connect-mounts-form"
import type { ConnectMountsFormMode, ModelMountPoint } from "./connect-mounts-form-model"

export function ConnectMountsTaskPanel(
  props: BodyFeatureTaskPanelProps & { parts: readonly ResolvedAuthoredPart[] },
) {
  const { report, activeTool } = props
  const t = useTranslations("app.connectMounts")
  const task = useTranslations("app.shell.taskPanel")
  const tree = useTranslations("app.shell.modelTree")
  const editing =
    activeTool.kind === "edit-connect-mounts"
      ? report.snapshot.features.find(({ id }) => id === activeTool.featureId)
      : undefined
  const options = useExactSolidBodyOptions(
    report.snapshot,
    report.rebuild,
    editing?.id,
    props.parts,
    tree("unnamedFeature"),
  )
  const modelPoints = useMemo<readonly ModelMountPoint[]>(
    () =>
      options.flatMap((option) => {
        if (!option.body) return []
        const elements = inspectTopologyMeasurements(report.snapshot, report.rebuild, option.body)
        return (elements ?? [])
          .filter(({ kind }) => kind === "face")
          .map((element, index) => ({
            id: JSON.stringify([option.id, element.id]),
            label: t("faceCenter", { body: option.label, number: index + 1 }),
            position: element.centroid,
          }))
      }),
    [options, report, t],
  )
  let mode: ConnectMountsFormMode | null = null
  if (activeTool.kind === "create-connect-mounts") {
    mode = {
      kind: "create",
      createFeatureId: createBrowserFeatureId,
      featureLabel: t("featureLabel", {
        number:
          report.snapshot.features.filter((feature) => readConnectMountsFeatureParameters(feature))
            .length + 1,
      }),
    }
  } else if (editing && readConnectMountsFeatureParameters(editing)) {
    mode = { kind: "edit", feature: editing }
  }
  if (!mode) return null
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={editing && props.renderDelete(editing)}
    >
      <ConnectMountsForm
        key={featureTaskKey(mode, report.snapshot.revision)}
        mode={mode}
        modelPoints={modelPoints}
        variables={report.snapshot.variables}
        {...featureTaskFormProps(props, mode)}
      />
    </TaskPanelSurface>
  )
}
