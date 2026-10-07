import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { readFdmFeatureParameters } from "@vibeshape/domain/part-design-fdm"
import { useTranslations } from "@vibeshape/i18n"
import { useState } from "react"
import { createBrowserFeatureId } from "../document/document-controller"
import { FdmForm } from "../features/fdm/fdm-form"
import type { FdmToolKind } from "../features/fdm/fdm-form-fields"
import type { FdmFormMode } from "../features/fdm/fdm-form-model"
import { exactSolidBodyOptions } from "../features/part-design/exact-body-options"
import { referenceFrameOptions } from "../features/reference-geometry/reference-frame-options"
import type { BodyFeatureTaskPanelProps } from "./body-feature-task-mode"
import { featureTaskFormProps } from "./feature-task-form-props"

export function FdmTaskPanel(
  props: BodyFeatureTaskPanelProps & { parts: readonly ResolvedAuthoredPart[] },
) {
  const { report, activeTool } = props
  const editing =
    activeTool.kind === "edit-fdm"
      ? report.snapshot.features.find(({ id }) => id === activeTool.featureId)
      : undefined
  const saved = editing ? readFdmFeatureParameters(editing) : null
  const [createKind, setKind] = useState<FdmToolKind>("web")
  const kind = saved?.kind ?? createKind
  const t = useTranslations("app.fdm"),
    task = useTranslations("app.shell.taskPanel"),
    tree = useTranslations("app.shell.modelTree")
  const mode: FdmFormMode | null =
    activeTool.kind === "create-fdm"
      ? {
          kind: "create",
          createFeatureId: createBrowserFeatureId,
          featureLabel: t("featureLabel", {
            number:
              report.snapshot.features.filter((feature) => readFdmFeatureParameters(feature))
                .length + 1,
          }),
        }
      : editing && saved
        ? { kind: "edit", feature: editing }
        : null
  if (!mode) return null
  const options = exactSolidBodyOptions(
    report.snapshot,
    report.rebuild,
    editing?.id,
    props.parts,
    tree("unnamedFeature"),
  )
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <FdmForm
        key={`${editing?.id ?? "create"}:${report.snapshot.revision}:${kind}`}
        kind={kind}
        onKindChange={setKind}
        mode={mode}
        options={options}
        sketches={report.snapshot.sketches}
        variables={report.snapshot.variables}
        frameOptions={referenceFrameOptions(report.snapshot, report.rebuild, editing?.id)}
        {...featureTaskFormProps(props, mode)}
      />
      {editing && props.renderDelete(editing)}
    </aside>
  )
}
