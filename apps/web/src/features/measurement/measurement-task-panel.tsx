import { createModelBodyMeasurementEvidence } from "@vibeshape/application/model-measurements"
import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain"
import { useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { MeasurementPanel } from "./measurement-panel"

const dispatcher = (() => {
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.dispatcher
})()

type BodyMeasurementResult = NonNullable<ReturnType<typeof dispatcher.dispatch>>

function createBodyMeasurementQuery({
  documentId,
  revision,
  cursor,
  allOutputs,
  selectedFeatureId,
  selectedOutputRole,
}: Readonly<{
  documentId: string
  revision: number
  cursor: string | null
  allOutputs: boolean
  selectedFeatureId: string | null
  selectedOutputRole: string | null | undefined
}>) {
  return {
    kind: "org.vibeshape.model.body-measurements" as const,
    schemaVersion: 1 as const,
    documentId,
    revision,
    cursor,
    limit: 20,
    ...(!allOutputs && selectedFeatureId ? { featureId: selectedFeatureId } : {}),
    ...(!allOutputs && selectedFeatureId && selectedOutputRole
      ? { outputRole: selectedOutputRole }
      : {}),
  }
}

function bodyMeasurementView(result: BodyMeasurementResult | null) {
  return result?.ok && result.view.kind === "org.vibeshape.model.body-measurements"
    ? result.view
    : null
}

function unavailableMessage(result: BodyMeasurementResult | null) {
  if (!result) return "unavailable" as const
  if (result?.ok) return "unavailable" as const
  if (result.diagnostic.code === "feature-not-measurable") return "featureNotMeasurable" as const
  if (result.diagnostic.code === "body-not-found") return "bodyNotFound" as const
  return "unavailable" as const
}

// The owning task boundary is keyed by document, revision, and viewport selection.
export function MeasurementTaskPanel({
  controller,
  selectedFeatureId,
  selectedOutputRole,
  onClose,
}: Readonly<{
  controller: DocumentControllerState
  selectedFeatureId: string | null
  selectedOutputRole?: string | null
  onClose: () => void
}>) {
  const [allOutputs, setAllOutputs] = useState(false)
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null])
  const report = controller.report
  const evidence = useMemo(
    () => (report ? createModelBodyMeasurementEvidence(report.snapshot, report.rebuild) : null),
    [report],
  )
  const available = controller.status === "ready" && controller.saveStatus !== "saving"
  const cursor = cursors.at(-1) ?? null
  const result = useMemo(() => {
    if (!available || !report || !evidence?.ok) return null
    return dispatcher.dispatch(
      report.snapshot,
      createBodyMeasurementQuery({
        documentId: report.snapshot.id,
        revision: report.snapshot.revision,
        cursor,
        allOutputs,
        selectedFeatureId,
        selectedOutputRole,
      }),
      { bodyMeasurements: evidence.evidence },
    )
  }, [available, report, evidence, cursor, selectedFeatureId, selectedOutputRole, allOutputs])
  const view = bodyMeasurementView(result)
  const next = view?.nextCursor
  return (
    <MeasurementPanel
      key={`${cursor}:${allOutputs}:${selectedFeatureId ?? ""}:${selectedOutputRole ?? ""}`}
      view={view}
      unavailable={!view}
      unavailableMessage={unavailableMessage(result)}
      onClose={onClose}
      onPrevious={
        cursors.length > 1 ? () => setCursors((previous) => previous.slice(0, -1)) : undefined
      }
      onNext={next ? () => setCursors((previous) => [...previous, next]) : undefined}
      onAllOutputs={
        !allOutputs && selectedFeatureId
          ? () => {
              setAllOutputs(true)
              setCursors([null])
            }
          : undefined
      }
    />
  )
}
