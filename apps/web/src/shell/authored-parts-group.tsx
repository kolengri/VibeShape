import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { FeatureId, PartId } from "@vibeshape/domain/identifiers"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@vibeshape/ui/components/context-menu"
import { ChevronDown, CircleAlert, Cuboid, Eye, EyeOff } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ReactNode, useState } from "react"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { AuthoredItemRename, type AuthoredMetadataCommit } from "./authored-item-rename"
import { selectedAuthoredBody } from "./authored-tree-state"

type PartsProps = {
  parts: readonly ResolvedAuthoredPart[]
  revision: number
  selectedPartId: PartId | null
  disabled: boolean
  onSelect: (partId: PartId) => void
  onPreselect?: ((body: ModelBodySelection | null) => void) | undefined
  onSurfaceTexture?: ((featureId: FeatureId, outputRole: string) => void) | undefined
  onCommit: AuthoredMetadataCommit
}

function MeshOperationNotice({
  selected,
  resolved,
}: {
  selected: boolean
  resolved: ResolvedAuthoredPart
}) {
  const t = useTranslations("app.authoredTree")
  if (!selected || resolved.body?.representation !== "triangle-mesh") return null
  return <p className="ml-8 px-2 text-xs text-muted-foreground">{t("meshOperationsUnavailable")}</p>
}
function AuthoredPartRow({
  resolved,
  ...props
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.authoredTree")
  const { part, status } = resolved
  const [error, setError] = useState<string | null>(null)
  const selected = props.selectedPartId === part.id
  const highlight = selectedAuthoredBody([resolved], part.id)
  const visibilityLabel = t(part.visible ? "hidePart" : "showPart", { name: part.name })
  const toggleVisibility = async () => {
    setError(null)
    try {
      const result = await props.onCommit(props.revision, {
        kind: "part.set-visibility",
        partId: part.id,
        visible: !part.visible,
      })
      if (!result.ok)
        setError(
          t(
            result.diagnostic.sourceCode === "stale-revision"
              ? "visibilityStale"
              : "visibilityFailed",
          ),
        )
    } catch {
      setError(t("visibilityFailed"))
    }
  }
  return (
    <PartTextureContext
      resolved={resolved}
      disabled={props.disabled}
      onSurfaceTexture={props.onSurfaceTexture}
    >
      <div
        role="none"
        data-part-id={part.id}
        data-part-status={status}
        data-part-visible={part.visible}
        onPointerEnter={() => props.onPreselect?.(highlight)}
        onPointerLeave={() => props.onPreselect?.(null)}
      >
        <div role="none" className="flex min-w-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            role="treeitem"
            tabIndex={-1}
            aria-selected={selected}
            aria-label={t("partLabel", { name: part.name })}
            aria-describedby={`part-status-${part.id}`}
            className={cn(
              "min-w-0 flex-1 justify-start pl-6 font-normal",
              selected && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
            )}
            onClick={() => props.onSelect(part.id)}
            onFocus={() => props.onPreselect?.(highlight)}
            onBlur={() => props.onPreselect?.(null)}
          >
            <Cuboid aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{part.name}</span>
          </Button>
          <AuthoredItemRename
            item={part}
            kind="part"
            revision={props.revision}
            disabled={props.disabled}
            onCommit={props.onCommit}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={props.disabled}
                aria-label={visibilityLabel}
                aria-pressed={part.visible}
                onClick={toggleVisibility}
              >
                {part.visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{visibilityLabel}</TooltipContent>
          </Tooltip>
        </div>
        <p
          id={`part-status-${part.id}`}
          className={cn(
            "ml-8 flex items-center gap-1 px-2 text-[10px] text-muted-foreground",
            status === "available" && "sr-only",
          )}
        >
          {(status === "unavailable" || status === "upstream") && (
            <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
          )}
          {t(status)}
        </p>
        <MeshOperationNotice selected={selected} resolved={resolved} />
        {error && (
          <p role="alert" className="px-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </PartTextureContext>
  )
}

function PartTextureContext({
  resolved,
  disabled,
  onSurfaceTexture,
  children,
}: {
  resolved: ResolvedAuthoredPart
  disabled: boolean
  onSurfaceTexture: PartsProps["onSurfaceTexture"]
  children: ReactNode
}) {
  const t = useTranslations("app.surfaceTexture")
  if (!onSurfaceTexture) return children
  const body = resolved.body
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={disabled || !body || body.representation === "triangle-mesh"}
          onSelect={() => {
            if (body && body.representation !== "triangle-mesh")
              onSurfaceTexture(body.featureId, body.outputRole ?? "result")
          }}
        >
          {t("title")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function AuthoredPartsGroup(props: PartsProps) {
  const t = useTranslations("app.authoredTree")
  const [expanded, setExpanded] = useState(true)
  return (
    <div role="none">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        role="treeitem"
        tabIndex={-1}
        aria-expanded={expanded}
        className="w-full justify-start font-medium"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0", !expanded && "-rotate-90")}
        />
        {t("parts")}
      </Button>
      {expanded && (
        <fieldset className="contents">
          <legend className="sr-only">{t("parts")}</legend>
          {props.parts.length ? (
            props.parts.map((resolved) => (
              <AuthoredPartRow key={resolved.part.id} {...props} resolved={resolved} />
            ))
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("emptyParts")}</p>
          )}
        </fieldset>
      )}
    </div>
  )
}
