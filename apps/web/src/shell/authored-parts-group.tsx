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
import { authoredPlacementTarget } from "../features/part-design/authored-part-selection"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { AuthoredItemRename, type AuthoredMetadataCommit } from "./authored-item-rename"
import { selectedAuthoredBody } from "./authored-tree-state"

type PartsProps = {
  parts: readonly ResolvedAuthoredPart[]
  revision: number
  selectedPartId: PartId | null
  disabled: boolean
  onSelect: (partId: PartId) => void
  onCombine?: ((operation: "compound" | "union") => void) | undefined
  onPlace?: ((partId: PartId) => void) | undefined
  onShell?: ((partId: PartId) => void) | undefined
  onSplit?: ((partId: PartId) => void) | undefined
  onPattern?: ((partId: PartId) => void) | undefined
  onThread?: ((partId: PartId) => void) | undefined
  onMirror?: ((partId: PartId) => void) | undefined
  onPreselect?: ((body: ModelBodySelection | null) => void) | undefined
  onSurfaceTexture?: ((featureId: FeatureId, outputRole: string) => void) | undefined
  onCommit: AuthoredMetadataCommit
}

function PartPlacementAction({
  resolved,
  onPlace,
  selectedPartId,
  disabled,
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.authoredTree")
  if (selectedPartId !== resolved.part.id || !onPlace) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="mb-1 ml-8"
      aria-label={t("placePart", { name: resolved.part.name })}
      disabled={disabled || !authoredPlacementTarget(resolved)}
      onClick={() => onPlace(resolved.part.id)}
    >
      {t("place")}
    </Button>
  )
}
function PartMirrorAction({
  resolved,
  onMirror,
  selectedPartId,
  disabled,
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.mirror")
  if (selectedPartId !== resolved.part.id || !onMirror) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="mb-1 ml-2"
      aria-label={t("mirrorPart", { name: resolved.part.name })}
      disabled={disabled || !authoredPlacementTarget(resolved)}
      onClick={() => onMirror(resolved.part.id)}
    >
      {t("action")}
    </Button>
  )
}

function PartShellAction({
  resolved,
  onShell,
  selectedPartId,
  disabled,
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.shellOperation")
  if (selectedPartId !== resolved.part.id || !onShell) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="mb-1 ml-2"
      aria-label={t("shellPart", { name: resolved.part.name })}
      disabled={disabled || !authoredPlacementTarget(resolved)}
      onClick={() => onShell(resolved.part.id)}
    >
      {t("action")}
    </Button>
  )
}

function PartSplitAction({
  resolved,
  onSplit,
  selectedPartId,
  disabled,
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.split")
  if (selectedPartId !== resolved.part.id || !onSplit) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="mb-1 ml-2"
      aria-label={t("splitPart", { name: resolved.part.name })}
      disabled={disabled || !authoredPlacementTarget(resolved)}
      onClick={() => onSplit(resolved.part.id)}
    >
      {t("action")}
    </Button>
  )
}

function PartPatternAction({
  resolved,
  onPattern,
  selectedPartId,
  disabled,
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.bodyPattern")
  if (selectedPartId !== resolved.part.id || !onPattern) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="mb-1 ml-2"
      aria-label={t("patternPart", { name: resolved.part.name })}
      disabled={disabled || !authoredPlacementTarget(resolved)}
      onClick={() => onPattern(resolved.part.id)}
    >
      {t("action")}
    </Button>
  )
}

function PartThreadAction({
  resolved,
  onThread,
  selectedPartId,
  disabled,
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.thread")
  if (selectedPartId !== resolved.part.id || !onThread) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="mb-1 ml-2"
      aria-label={t("threadPart", { name: resolved.part.name })}
      disabled={disabled || !authoredPlacementTarget(resolved)}
      onClick={() => onThread(resolved.part.id)}
    >
      {t("action")}
    </Button>
  )
}

function PartCombinationActions({
  parts,
  disabled,
  onCombine,
}: Pick<PartsProps, "parts" | "disabled" | "onCombine">) {
  const t = useTranslations("app.authoredTree")
  if (!onCombine) return null
  const bodies = parts.flatMap((part) => {
    const body = authoredPlacementTarget(part)
    return body ? [body] : []
  })
  const selections = new Set(
    bodies.map(({ featureId, outputRole }) => `${featureId}:${outputRole}`),
  )
  return (
    <div className="grid gap-1 px-2 py-1">
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || selections.size < 2}
          onClick={() => onCombine("compound")}
        >
          {t("compound")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || selections.size < 2}
          onClick={() => onCombine("union")}
        >
          {t("union")}
        </Button>
      </div>
      {bodies.length >= 2 && selections.size < 2 && (
        <p className="text-xs text-muted-foreground">{t("combinationSiblingRestriction")}</p>
      )}
    </div>
  )
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
        <PartPlacementAction resolved={resolved} {...props} />
        <PartMirrorAction resolved={resolved} {...props} />
        <PartShellAction resolved={resolved} {...props} />
        <PartSplitAction resolved={resolved} {...props} />
        <PartPatternAction resolved={resolved} {...props} />
        <PartThreadAction resolved={resolved} {...props} />
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
          <PartCombinationActions {...props} />
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
