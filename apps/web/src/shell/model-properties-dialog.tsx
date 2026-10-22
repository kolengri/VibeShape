import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { createModelBodyMeasurementEvidence } from "@vibeshape/application/model-measurements"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { useMemo } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { BodyShapeMeasurements } from "../features/measurement/measurement-panel"
import type { ModelBodySelection } from "../features/part-design/model-bodies"

export function ModelPropertiesDialog({
  controller,
  body,
  part,
  onClose,
  onAppearance,
}: {
  controller: DocumentControllerState
  body: ModelBodySelection
  part: ResolvedAuthoredPart | undefined
  onClose: () => void
  onAppearance?: (() => void) | undefined
}) {
  const t = useTranslations("app.viewportContext")
  const report = controller.report
  const evidence = useMemo(
    () => (report ? createModelBodyMeasurementEvidence(report.snapshot, report.rebuild) : null),
    [report],
  )
  const entry =
    controller.status === "ready" && controller.saveStatus !== "saving" && evidence?.ok
      ? evidence.evidence.bodies.find(
          (candidate) =>
            candidate.featureId === body.featureId && candidate.outputRole === body.outputRole,
        )
      : undefined
  const feature = report?.snapshot.features.find((candidate) => candidate.id === body.featureId)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent closeLabel={t("close")} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("properties")}</DialogTitle>
          <DialogDescription>{t("propertiesDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("name")}</dt>
              <dd className="break-words">{part?.part.name ?? feature?.label ?? t("unnamed")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("feature")}</dt>
              <dd className="break-words">
                {feature?.label ?? feature?.type.typeId ?? t("unavailable")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("output")}</dt>
              <dd className="break-words font-mono text-xs">
                {body.outputRole ?? t("wholeOutput")}
              </dd>
            </div>
          </dl>
          {entry ? (
            <BodyShapeMeasurements shape={entry.shape} />
          ) : (
            <Alert>{t("unavailable")}</Alert>
          )}
        </DialogBody>
        {onAppearance ? (
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onAppearance}>
              {t("editAppearance")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
