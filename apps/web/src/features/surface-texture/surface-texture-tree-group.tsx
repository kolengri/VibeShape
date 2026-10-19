import type { FeatureId } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ChevronDown, Layers3 } from "@vibeshape/ui/components/icons"
import { useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { modelBrowserChildRow, modelBrowserGroupRow } from "../../shell/model-browser-styles"

export function SurfaceTextureTreeGroup({
  controller,
  disabled,
  onEdit,
}: {
  controller: DocumentControllerState
  disabled: boolean
  onEdit: (featureId: FeatureId, outputRole: string) => void
}) {
  const t = useTranslations("app.surfaceTexture")
  const [expanded, setExpanded] = useState(true)
  const snapshot = controller.authoredSnapshot
  if (!snapshot || !("surfaceTextures" in snapshot) || snapshot.surfaceTextures.length === 0)
    return null
  const bodies = new Map<string, { featureId: FeatureId; outputRole: string; count: number }>()
  for (const layer of snapshot.surfaceTextures) {
    const key = `${layer.featureId}:${layer.target.outputRole}`
    const body = bodies.get(key) ?? {
      featureId: layer.featureId,
      outputRole: layer.target.outputRole,
      count: 0,
    }
    body.count += 1
    bodies.set(key, body)
  }
  return (
    <div role="none">
      <Button
        type="button"
        role="treeitem"
        tabIndex={-1}
        aria-expanded={expanded}
        aria-selected={false}
        variant="ghost"
        size="sm"
        className={modelBrowserGroupRow}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown aria-hidden="true" className={expanded ? "size-4" : "size-4 -rotate-90"} />
        <Layers3 aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t("treeGroup")}</span>
      </Button>
      {expanded && (
        <fieldset aria-label={t("treeGroup")}>
          {[...bodies.entries()].map(([key, body]) => (
            <Button
              type="button"
              key={key}
              role="treeitem"
              aria-selected={false}
              tabIndex={-1}
              disabled={disabled}
              size="sm"
              variant="ghost"
              className={modelBrowserChildRow}
              onClick={() => onEdit(body.featureId, body.outputRole)}
            >
              <Layers3 aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate">
                {t("bodyLayerCount", {
                  body:
                    snapshot.features.find(({ id }) => id === body.featureId)?.label ??
                    t("unnamedBody"),
                  count: body.count,
                })}
              </span>
            </Button>
          ))}
        </fieldset>
      )}
    </div>
  )
}
