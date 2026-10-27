import {
  type ModelDependenciesQuery,
  queryModelDependencies,
} from "@vibeshape/automation-api/queries"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { DocumentNodeRef } from "@vibeshape/domain/document-node"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { type RefObject, useMemo, useState } from "react"
import type { DocumentControllerState } from "../document/document-controller"

type DialogProps = {
  entity: DocumentNodeRef
  label: string
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export function HistoryDependenciesDialog({
  controller,
  ...props
}: DialogProps & { controller: DocumentControllerState }) {
  const snapshot =
    controller.status === "ready" && controller.saveStatus !== "saving"
      ? (controller.report?.snapshot ?? null)
      : null
  return (
    <HistoryDependenciesContent
      key={snapshot ? `${snapshot.id}:${snapshot.revision}` : "unavailable"}
      {...props}
      snapshot={snapshot}
    />
  )
}

function HistoryDependenciesContent({
  snapshot,
  entity,
  label,
  onClose,
  triggerRef,
}: DialogProps & { snapshot: DocumentSnapshot | null }) {
  const t = useTranslations("app.shell.modelTree.dependencies")
  const [direction, setDirection] = useState<ModelDependenciesQuery["direction"]>("dependents")
  const [transitive, setTransitive] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const result = useMemo(
    () =>
      queryModelDependencies(snapshot, {
        kind: "org.vibeshape.cad.dependencies",
        schemaVersion: 1,
        documentId: snapshot?.id,
        revision: snapshot?.revision,
        entity,
        direction,
        transitive,
        cursor,
      }),
    [snapshot, entity, direction, transitive, cursor],
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        closeLabel={t("close")}
        className="max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title", { item: label })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <fieldset className="flex flex-wrap gap-2" aria-label={t("direction")}>
            {(["dependents", "dependencies"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={direction === value ? "secondary" : "outline"}
                aria-pressed={direction === value}
                onClick={() => {
                  setDirection(value)
                  setCursor(null)
                }}
              >
                {t(value)}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={transitive}
              onClick={() => {
                setTransitive(!transitive)
                setCursor(null)
              }}
            >
              {t("transitive")}
            </Button>
          </fieldset>
          {result.ok ? (
            <div className="mt-3 space-y-3" aria-live="polite">
              <p className="text-xs text-muted-foreground">
                {t("summary", { count: result.view.data.total, revision: result.view.revision })}
              </p>
              {result.view.data.coverage === "partial" && <Alert>{t("partial")}</Alert>}
              {result.view.data.total === 0 ? (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              ) : (
                <ul className="space-y-2" aria-label={t(direction)}>
                  {result.view.data.items.map((item) => (
                    <li key={`${item.entity.kind}:${item.entity.id}`} className="text-sm">
                      <p className="break-words font-medium">
                        {item.label ?? t("unnamed", { kind: item.entity.kind })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("entry", { kind: item.entity.kind, distance: item.distance })}
                        {item.suppressed && <span className="ml-2">{t("suppressed")}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                {cursor !== null && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setCursor(null)}>
                    {t("firstPage")}
                  </Button>
                )}
                {result.view.nextCursor !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCursor(result.view.nextCursor)}
                  >
                    {t("nextPage")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Alert className="mt-3">{t("unavailable")}</Alert>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
