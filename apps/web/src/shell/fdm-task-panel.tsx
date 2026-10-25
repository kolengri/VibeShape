import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { readFdmFeatureParameters } from "@vibeshape/domain/part-design-fdm"
import { useTranslations } from "@vibeshape/i18n"
import { useLayoutEffect, useRef, useState } from "react"
import { TaskPanelSurface } from "../components/task-panel-layout"
import { createBrowserFeatureId } from "../document/document-controller"
import { FdmForm } from "../features/fdm/fdm-form"
import type { FdmToolKind } from "../features/fdm/fdm-form-fields"
import type { FdmFormMode } from "../features/fdm/fdm-form-model"
import { useExactSolidBodyOptions } from "../features/part-design/exact-body-options"
import { useReferenceFrameOptions } from "../features/reference-geometry/use-reference-frame-options"
import type { BodyFeatureTaskPanelProps } from "./body-feature-task-mode"
import { featureTaskFormProps } from "./feature-task-form-props"

function useFdmKindPicker(savedKind: FdmToolKind | undefined) {
  const [createKind, setKind] = useState<FdmToolKind>("web")
  const kind = savedKind ?? createKind
  const kindControlRef = useRef<HTMLButtonElement>(null)
  const restoreKindFocus = useRef(false)
  useLayoutEffect(() => {
    if (!restoreKindFocus.current) return
    restoreKindFocus.current = false
    kindControlRef.current?.focus()
  }, [kind])
  return {
    kind,
    kindControlRef,
    onKindChange: (nextKind: FdmToolKind) => {
      if (nextKind === kind) return
      // Switching kind remounts its parameter form; keep keyboard navigation at the picker.
      restoreKindFocus.current = true
      setKind(nextKind)
    },
  }
}

export function FdmTaskPanel(
  props: BodyFeatureTaskPanelProps & { parts: readonly ResolvedAuthoredPart[] },
) {
  const { report, activeTool } = props
  const editing =
    activeTool.kind === "edit-fdm"
      ? report.snapshot.features.find(({ id }) => id === activeTool.featureId)
      : undefined
  const saved = editing ? readFdmFeatureParameters(editing) : null
  const { kind, kindControlRef, onKindChange } = useFdmKindPicker(saved?.kind)
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
  const frameOptions = useReferenceFrameOptions(report.snapshot, report.rebuild, editing?.id)
  const options = useExactSolidBodyOptions(
    report.snapshot,
    report.rebuild,
    editing?.id,
    props.parts,
    tree("unnamedFeature"),
    undefined,
    mode !== null,
  )
  if (!mode) return null
  return (
    <TaskPanelSurface
      aria-label={task("ariaLabel")}
      trailingContent={editing && props.renderDelete(editing)}
    >
      <FdmForm
        key={`${editing?.id ?? "create"}:${report.snapshot.revision}:${kind}`}
        kind={kind}
        kindControlRef={kindControlRef}
        onKindChange={onKindChange}
        mode={mode}
        options={options}
        sketches={report.snapshot.sketches}
        variables={report.snapshot.variables}
        frameOptions={frameOptions}
        {...featureTaskFormProps(props, mode)}
      />
    </TaskPanelSurface>
  )
}
