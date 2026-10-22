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
import { ChevronDown, Cuboid, Eye, EyeOff, WarningIcon } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { DocumentMutationResult } from "../document/document-controller"
import {
  effectivePartVisibility,
  type PartVisibilityControl,
} from "../editor-session/part-visibility"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { useReportApplicationError, useReportApplicationSuccess } from "./application-notices"
import { AuthoredItemRename, type AuthoredMetadataCommit } from "./authored-item-rename"
import { selectedAuthoredBody } from "./authored-tree-state"
import {
  modelBrowserChildRow,
  modelBrowserCount,
  modelBrowserGroupRow,
  modelBrowserHighlightedRow,
  modelBrowserItem,
  modelBrowserSelectedRow,
} from "./model-browser-styles"

type PartsProps = {
  revealRequest?: Readonly<{ featureId: FeatureId; sequence: number }> | null
  parts: readonly ResolvedAuthoredPart[]
  revision: number
  selectedPartId: PartId | null
  selectedPartIds?: readonly PartId[] | undefined
  highlightedPartIds?: readonly PartId[] | undefined
  disabled: boolean
  visibility?: PartVisibilityControl | undefined
  presentationOnlyVisibility?: boolean | undefined
  visibilityDisabled?: boolean | undefined
  selectionRequiresBody?: boolean | undefined
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
  return (
    <p className="pl-14 pr-2 text-xs text-muted-foreground">{t("meshOperationsUnavailable")}</p>
  )
}

function AuthoredPartStatus({
  partId,
  status,
  atInsertionPoint,
}: {
  partId: PartId
  status: ResolvedAuthoredPart["status"]
  atInsertionPoint: boolean
}) {
  const t = useTranslations("app.authoredTree")
  const warning = status === "unavailable" || (status === "upstream" && !atInsertionPoint)
  const label = status === "upstream" && atInsertionPoint ? "insertionUpstream" : status
  return (
    <p
      id={`part-status-${partId}`}
      className={cn(
        "flex items-center gap-1 pl-14 pr-2 text-xs text-muted-foreground",
        status === "available" && "sr-only",
      )}
    >
      {warning && <WarningIcon className="size-3 shrink-0" aria-hidden="true" />}
      {t(label)}
    </p>
  )
}

function PartVisibilityButton({
  name,
  visible,
  controls,
  onToggle,
}: {
  name: string
  visible: boolean
  controls: Pick<
    PartsProps,
    "visibilityDisabled" | "disabled" | "presentationOnlyVisibility" | "visibility"
  >
  onToggle: () => Promise<void>
}) {
  const t = useTranslations("app.authoredTree")
  const label = t(visible ? "hidePart" : "showPart", { name })
  const disabled =
    (controls.visibilityDisabled ?? controls.disabled) ||
    (controls.presentationOnlyVisibility && !controls.visibility)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={label}
          aria-pressed={visible}
          onClick={onToggle}
        >
          {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function PartVisibilityError({ message, attempt }: { message: string | null; attempt: number }) {
  const applicationOwnsError = useReportApplicationError(message, attempt)
  if (!message || applicationOwnsError) return null
  return (
    <p
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 rounded-md border border-destructive bg-popover p-3 text-sm text-destructive shadow-lg"
    >
      {message}
    </p>
  )
}

function PartVisibilityNotice({ message, attempt }: { message: string | null; attempt: number }) {
  const applicationOwnsNotice = useReportApplicationSuccess(message, attempt)
  if (!message || applicationOwnsNotice) return null
  return (
    <p
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      {message}
    </p>
  )
}

function visibilityFailureMessage(
  diagnostic: Extract<DocumentMutationResult, { ok: false }>["diagnostic"],
) {
  if (diagnostic.code === "write-access-unavailable") return "visibilityReadOnly"
  if (diagnostic.sourceCode === "stale-revision") return "visibilityStale"
  if (diagnostic.code !== "command-rejected") return "visibilityFailed"
  return visibilityGuardMessage(diagnostic.sourceCode)
}

function visibilityGuardMessage(sourceCode: string | null | undefined) {
  switch (sourceCode) {
    case "automation-busy":
      return "visibilityBusy"
    case "editor-draft":
    case "surface-texture-draft":
      return "visibilityEditing"
    case "save-in-progress":
      return "visibilitySaving"
    case "read-only":
      return "visibilityReadOnly"
    case "document-unavailable":
      return "visibilityUnavailable"
    default:
      return "visibilityFailed"
  }
}

function isTemporaryVisibilityRejection(result: DocumentMutationResult) {
  return (
    !result.ok &&
    result.diagnostic.code === "command-rejected" &&
    result.diagnostic.sourceCode === "automation-busy"
  )
}

type VisibilityAuthority = Readonly<{
  revision: number
  visible: boolean
  override: boolean | undefined
}>

function sameVisibilityAuthority(latest: VisibilityAuthority, base: VisibilityAuthority) {
  return (
    latest.revision === base.revision &&
    latest.visible === base.visible &&
    latest.override === base.override
  )
}

function canClearCommittedOverride(
  latest: VisibilityAuthority,
  base: VisibilityAuthority,
  requestedVisible: boolean,
) {
  if (latest.override !== base.override) return false
  if (latest.revision === base.revision) return latest.visible === base.visible
  return latest.revision === base.revision + 1 && latest.visible === requestedVisible
}

function usePartVisibility(part: ResolvedAuthoredPart["part"], props: Omit<PartsProps, "parts">) {
  const t = useTranslations("app.authoredTree")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [visibilityAttempt, setVisibilityAttempt] = useState(0)
  const visible = effectivePartVisibility(part, props.visibility?.overrides)
  const generation = useRef(0)
  const current = useRef({
    revision: props.revision,
    visible: part.visible,
    override: props.visibility?.overrides[part.id],
  })
  useLayoutEffect(() => {
    current.current = {
      revision: props.revision,
      visible: part.visible,
      override: props.visibility?.overrides[part.id],
    }
  }, [props.revision, part.visible, props.visibility?.overrides, part.id])
  useLayoutEffect(() => {
    setError(null)
    setNotice(null)
    return () => {
      generation.current += 1
    }
  }, [
    part.id,
    props.onCommit,
    props.visibility?.setOverride,
    props.visibility?.clearOverride,
    props.presentationOnlyVisibility,
  ])

  function reportRejection(
    result: Extract<DocumentMutationResult, { ok: false }>,
    requestedVisible: boolean,
  ) {
    if (isTemporaryVisibilityRejection(result) && props.visibility) {
      props.visibility.setOverride(part.id, requestedVisible)
      setNotice(t("visibilityTemporary", { name: part.name }))
    } else setError(t(visibilityFailureMessage(result.diagnostic), { name: part.name }))
  }

  function applyCommitResult(
    result: DocumentMutationResult,
    base: VisibilityAuthority,
    requestedVisible: boolean,
  ) {
    if (result.ok) {
      if (canClearCommittedOverride(current.current, base, requestedVisible))
        props.visibility?.clearOverride(part.id)
    } else if (sameVisibilityAuthority(current.current, base))
      reportRejection(result, requestedVisible)
  }

  async function commitVisibility(requestedVisible: boolean) {
    const started = generation.current
    const base = current.current
    try {
      const result = await props.onCommit(props.revision, {
        kind: "part.set-visibility",
        partId: part.id,
        visible: requestedVisible,
      })
      if (generation.current === started) applyCommitResult(result, base, requestedVisible)
    } catch {
      if (generation.current === started && sameVisibilityAuthority(current.current, base))
        setError(t("visibilityFailed", { name: part.name }))
    }
  }

  const toggleVisibility = async () => {
    setVisibilityAttempt((attempt) => attempt + 1)
    setError(null)
    setNotice(null)
    const requestedVisible = !visible
    if (props.presentationOnlyVisibility) {
      props.visibility?.setOverride(part.id, requestedVisible)
      return
    }
    if (props.visibility?.overrides[part.id] !== undefined && requestedVisible === part.visible) {
      props.visibility.clearOverride(part.id)
      setNotice(t("visibilityRestored", { name: part.name }))
      return
    }
    await commitVisibility(requestedVisible)
  }
  return { visible, error, notice, visibilityAttempt, toggleVisibility }
}

function AuthoredPartRow({
  resolved,
  ...props
}: Omit<PartsProps, "parts"> & { resolved: ResolvedAuthoredPart }) {
  const t = useTranslations("app.authoredTree")
  const { part, status } = resolved
  const { visible, error, notice, visibilityAttempt, toggleVisibility } = usePartVisibility(
    part,
    props,
  )
  const selected = props.selectedPartIds?.includes(part.id) ?? props.selectedPartId === part.id
  const highlighted = props.highlightedPartIds?.includes(part.id)
  const highlight = selectedAuthoredBody([resolved], part.id, props.visibility?.overrides)
  return (
    <PartTextureContext
      resolved={resolved}
      disabled={props.disabled}
      onSurfaceTexture={props.onSurfaceTexture}
    >
      <div
        role="none"
        data-part-id={part.id}
        data-feature-id={highlight?.featureId}
        data-part-status={status}
        data-highlighted={highlighted}
        data-part-visible={visible}
        onPointerEnter={() => props.onPreselect?.(highlight)}
        onPointerLeave={() => props.onPreselect?.(null)}
        onPointerCancel={() => props.onPreselect?.(null)}
      >
        <div
          role="none"
          className={cn(
            modelBrowserItem,
            selected && modelBrowserSelectedRow,
            highlighted && modelBrowserHighlightedRow,
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="treeitem"
            tabIndex={-1}
            aria-selected={selected}
            data-model-tree-selection-key={`part:${part.id}`}
            aria-label={t("partLabel", { name: part.name })}
            aria-describedby={`part-status-${part.id}`}
            disabled={props.selectionRequiresBody && !highlight}
            className={cn(modelBrowserChildRow, "flex-1")}
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
          <PartVisibilityButton
            name={part.name}
            visible={visible}
            controls={props}
            onToggle={toggleVisibility}
          />
        </div>
        <AuthoredPartStatus
          partId={part.id}
          status={status}
          atInsertionPoint={Boolean(props.selectionRequiresBody)}
        />
        <MeshOperationNotice selected={selected} resolved={resolved} />
        <PartVisibilityError message={error} attempt={visibilityAttempt} />
        <PartVisibilityNotice message={notice} attempt={visibilityAttempt} />
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
  const [consumedExpanded, setConsumedExpanded] = useState(false)
  const activeParts = props.parts.filter(({ status }) => status !== "consumed")
  const consumedParts = props.parts.filter(({ status }) => status === "consumed")
  const consumedHighlighted = consumedParts.some(({ part }) =>
    props.highlightedPartIds?.includes(part.id),
  )
  useEffect(() => {
    if (props.revealRequest) setExpanded(true)
  }, [props.revealRequest])
  return (
    <div role="none">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        role="treeitem"
        tabIndex={-1}
        aria-expanded={expanded}
        className={modelBrowserGroupRow}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0", !expanded && "-rotate-90")}
        />
        <Cuboid aria-hidden="true" className="size-4 text-muted-foreground" />
        {t("parts")}
        <span aria-hidden="true" className={modelBrowserCount}>
          {activeParts.length}
        </span>
      </Button>
      {expanded && (
        <fieldset className="contents">
          <legend className="sr-only">{t("parts")}</legend>
          {activeParts.length ? (
            activeParts.map((resolved) => (
              <AuthoredPartRow key={resolved.part.id} {...props} resolved={resolved} />
            ))
          ) : (
            <p className="py-2 pl-14 pr-2 text-xs text-muted-foreground">{t("emptyParts")}</p>
          )}
          {consumedParts.length > 0 && (
            <div role="none">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                role="treeitem"
                tabIndex={-1}
                aria-expanded={consumedExpanded}
                data-highlighted={consumedHighlighted ? "true" : undefined}
                className={cn(
                  modelBrowserGroupRow,
                  "pl-7 text-muted-foreground",
                  consumedHighlighted && modelBrowserHighlightedRow,
                )}
                onClick={() => setConsumedExpanded(!consumedExpanded)}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-4 shrink-0", !consumedExpanded && "-rotate-90")}
                />
                {t("consumedParts")}
                <span aria-hidden="true" className={modelBrowserCount}>
                  {consumedParts.length}
                </span>
              </Button>
              {consumedExpanded && (
                <fieldset className="contents">
                  <legend className="sr-only">{t("consumedParts")}</legend>
                  {consumedParts.map((resolved) => (
                    <AuthoredPartRow key={resolved.part.id} {...props} resolved={resolved} />
                  ))}
                </fieldset>
              )}
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}
