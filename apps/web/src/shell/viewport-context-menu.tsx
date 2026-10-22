import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import {
  type FeatureId,
  featureIdSchema,
  readExtrusionProfileSet,
  readRevolveProfileSet,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@vibeshape/ui/components/context-menu"
import {
  Download,
  Eye,
  EyeOff,
  Layers3,
  ListFilter,
  MousePointer2,
  PenLine,
  Ruler,
  SketchIcon,
  Trash2,
  X,
} from "@vibeshape/ui/components/icons"
import { viewerBodyColor } from "@vibeshape/viewer"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { type ComponentType, type ReactNode, type SVGProps, useRef, useState } from "react"
import {
  type EditorCommandId,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"
import {
  commitAuthoredMetadata,
  type DocumentControllerState,
} from "../document/document-controller"
import { DocumentExportDialog } from "../document/document-export-dialog"
import type { PartVisibilityControl } from "../editor-session/part-visibility"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { useReportApplicationError, useReportApplicationSuccess } from "./application-notices"
import { usePartVisibility } from "./authored-parts-group"
import { currentAuthoredParts, currentAuthoredSnapshot } from "./authored-tree-state"
import type { EditorWorkspaceActions } from "./editor-workspace"
import { useHistorySelectionDelete } from "./history-selection-delete"
import { ModelPropertiesDialog } from "./model-properties-dialog"
import { partForModelBody } from "./model-tree-selection"
import { PartAppearanceDialog, PartAppearanceMenu } from "./part-appearance-controls"
import { type ViewportContextTarget, ViewportContextTargetContext } from "./viewport-context-target"

type RevealDestination = "browser" | "timeline"
type Props = {
  children: ReactNode
  controller: DocumentControllerState
  commands: readonly ResolvedEditorCommand[]
  actions: EditorWorkspaceActions
  enabled: boolean
  selectedBody: ModelBodySelection | null | undefined
  selection: ViewerSelection | null
  partVisibility: PartVisibilityControl | undefined
  hiddenFeatureIds: readonly FeatureId[]
  onReveal: (featureId: FeatureId, destination: RevealDestination) => void
}

type Request = ViewportContextTarget & {
  body: ModelBodySelection | null
  documentId: string | undefined
  revision: number | undefined
}

function MenuAction({
  label,
  icon: Icon,
  disabled,
  reason,
  shortcut,
  onSelect,
}: {
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  disabled?: boolean | undefined
  reason?: string | null | undefined
  shortcut?: string | undefined
  onSelect: () => void
}) {
  return (
    <ContextMenuItem disabled={Boolean(disabled)} onSelect={onSelect} aria-label={label}>
      <Icon aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span>{label}</span>
        {disabled && reason ? (
          <span className="block max-w-64 whitespace-normal text-xs text-muted-foreground">
            {reason}
          </span>
        ) : null}
      </span>
      {shortcut ? <kbd className="ml-3 text-xs text-muted-foreground">{shortcut}</kbd> : null}
    </ContextMenuItem>
  )
}

function RegisteredAction({
  command,
  disabled,
  label,
  run,
}: {
  command: ResolvedEditorCommand | undefined
  disabled: boolean
  label?: string | undefined
  run: (action: () => unknown) => void
}) {
  const copy = useEditorCommandCopy()
  if (!command) return null
  const { descriptor, eligibility } = command
  return (
    <ContextMenuItem
      disabled={disabled || !eligibility.enabled}
      onSelect={() => run(command.invoke)}
      aria-label={label ?? copy.label(descriptor)}
    >
      <EditorCommandIconView icon={descriptor.icon} />
      <span className="min-w-0 flex-1">
        {label ?? copy.label(descriptor)}
        {!eligibility.enabled ? (
          <span className="block max-w-64 whitespace-normal text-xs text-muted-foreground">
            {copy.disabledReason(eligibility.reason)}
          </span>
        ) : null}
      </span>
      {descriptor.shortcut ? (
        <kbd className="ml-3 text-xs text-muted-foreground">
          {editorCommandShortcutLabel(descriptor.shortcut)}
        </kbd>
      ) : null}
    </ContextMenuItem>
  )
}

function PartVisibilityAction({
  part,
  controller,
  visibility,
  disabled,
  run,
}: {
  part: ResolvedAuthoredPart
  controller: DocumentControllerState
  visibility: PartVisibilityControl | undefined
  disabled: boolean
  run: (action: () => unknown) => void
}) {
  const t = useTranslations("app.viewportContext")
  const state = usePartVisibility(part.part, {
    revision: currentAuthoredSnapshot(controller)?.revision ?? 0,
    visibility,
    onCommit: commitAuthoredMetadata,
  })
  useReportApplicationError(state.error)
  useReportApplicationSuccess(state.notice, state.visibilityAttempt)
  return (
    <MenuAction
      label={t(state.visible ? "hide" : "show")}
      icon={state.visible ? EyeOff : Eye}
      disabled={disabled}
      onSelect={() => run(state.toggleVisibility)}
    />
  )
}

function ProfileSketchAction({
  controller,
  featureId,
  disabled,
  run,
  actions,
}: {
  controller: DocumentControllerState
  featureId: FeatureId | undefined
  disabled: boolean
  run: (action: () => unknown) => void
  actions: EditorWorkspaceActions
}) {
  const t = useTranslations("app.viewportContext")
  const feature = controller.report?.snapshot.features.find((item) => item.id === featureId)
  const profiles = feature
    ? (readExtrusionProfileSet(feature) ?? readRevolveProfileSet(feature))
    : null
  const ids = [...new Set(profiles?.profiles.map((profile) => profile.sketchId))]
  if (ids.length <= 1)
    return (
      <MenuAction
        label={t("editProfileSketch")}
        icon={SketchIcon}
        disabled={disabled || !ids[0]}
        reason={!ids[0] ? t("noProfiles") : null}
        onSelect={() => {
          const id = ids[0]
          if (id) run(() => actions.editSketch(id))
        }}
      />
    )
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <SketchIcon aria-hidden="true" />
        {t("editProfileSketch")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {ids.map((id) => (
          <ContextMenuItem key={id} onSelect={() => run(() => actions.editSketch(id))}>
            <SketchIcon aria-hidden="true" />
            {controller.report?.snapshot.sketches.find((sketch) => sketch.id === id)?.label ?? id}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

function sameMenuRevision(
  request: Request | null,
  authority: ReturnType<typeof currentAuthoredSnapshot>,
) {
  return Boolean(
    request && request.documentId === authority?.id && request.revision === authority?.revision,
  )
}

function menuEligibility(
  props: Props,
  request: Request | null,
  pending: boolean,
  authority: ReturnType<typeof currentAuthoredSnapshot>,
) {
  const fresh = sameMenuRevision(request, authority)
  const writable =
    props.controller.status === "ready" &&
    props.controller.saveStatus === "saved" &&
    props.controller.report?.mode === "read-write"
  const disabled = !props.enabled || !fresh || pending
  return { fresh, writable, disabled, writeDisabled: disabled || !writable }
}

function useViewportMenu(props: Props) {
  const t = useTranslations("app.viewportContext")
  const [request, setRequest] = useState<Request | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"properties" | "export" | "appearance" | null>(null)
  const locked = useRef(false)
  const transferFocus = useRef(false)
  const authority = currentAuthoredSnapshot(props.controller)
  const { fresh, writable, disabled, writeDisabled } = menuEligibility(
    props,
    request,
    pending,
    authority,
  )
  const body = request?.body
  const featureId = body?.featureId
  const part = body ? partForModelBody(currentAuthoredParts(props.controller), body) : undefined
  const feature = props.controller.report?.snapshot.features.find((item) => item.id === featureId)
  const removal = useHistorySelectionDelete({
    controller: props.controller,
    targets: part
      ? [{ kind: "part", id: part.part.id }]
      : featureId
        ? [{ kind: "feature", id: featureId }]
        : [],
    disabled: writeDisabled,
    onDeleted: () => {
      request?.select(null)
      props.actions.clearSelection?.()
    },
  })
  const appOwnsError = useReportApplicationError(error)
  const run = async (action: () => unknown, moveFocus = false) => {
    if (locked.current || disabled) return
    locked.current = true
    setPending(true)
    setError(null)
    transferFocus.current = moveFocus
    try {
      await action()
    } catch {
      setError(t("failed"))
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  const command = (id: EditorCommandId, label?: string) => (
    <RegisteredAction
      key={id}
      command={props.commands.find((item) => item.descriptor.id === id)}
      disabled={id === editorCommandIds.measure ? disabled : writeDisabled}
      label={label}
      run={(action) => run(action, true)}
    />
  )
  const afterClose = useRef<(() => void) | null>(null)
  const reveal = (destination: RevealDestination) => {
    if (!featureId || disabled) return
    transferFocus.current = true
    afterClose.current = () => props.onReveal(featureId, destination)
  }
  const closeDialog = () => {
    setDialog(null)
    request?.focus.focus()
  }
  const closeMenuFocus = (event: Event) => {
    event.preventDefault()
    const deferred = afterClose.current
    afterClose.current = null
    if (deferred) requestAnimationFrame(deferred)
    else if (!transferFocus.current) request?.focus.focus({ preventScroll: true })
    transferFocus.current = false
  }
  return {
    t,
    request,
    setRequest,
    error,
    setError,
    dialog,
    setDialog,
    authority,
    fresh,
    writable,
    disabled,
    writeDisabled,
    body,
    featureId,
    part,
    feature,
    removal,
    appOwnsError,
    run,
    command,
    reveal,
    closeDialog,
    closeMenuFocus,
  }
}

type Menu = ReturnType<typeof useViewportMenu>

function bodySelection(
  picked: ModelBodySelection | ViewerSelection | null | undefined,
): ModelBodySelection | null {
  const id = featureIdSchema.safeParse(picked?.featureId)
  return picked && id.success
    ? {
        featureId: id.data,
        ...(picked.outputRole === undefined ? {} : { outputRole: picked.outputRole }),
      }
    : null
}

function useMenuTarget(props: Props, menu: Menu) {
  const { authority, setRequest, setError, setDialog } = menu
  const request = (target: ViewportContextTarget) => {
    setError(null)
    setRequest({
      ...target,
      body: bodySelection(target.face ?? props.selectedBody ?? props.selection),
      documentId: authority?.id,
      revision: authority?.revision,
    })
  }
  const inspect = (focus: HTMLElement) => {
    const body = bodySelection(props.selectedBody ?? props.selection)
    if (!body || !props.enabled) return
    setRequest({
      face: props.selection,
      candidates: [],
      focus,
      select: props.actions.select,
      preview: () => {},
      body,
      documentId: authority?.id,
      revision: authority?.revision,
    })
    setDialog("properties")
  }
  return {
    enabled: props.enabled,
    hasSelection: Boolean(props.selectedBody ?? props.selection),
    request,
    inspect,
  }
}

function SelectOtherActions({ props, menu }: { props: Props; menu: Menu }) {
  const { t, request, disabled, fresh } = menu
  return (
    <>
      {request && request.candidates.length > 1 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={disabled}>
            <MousePointer2 aria-hidden="true" />
            {t("selectOther")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent onPointerLeave={() => request.preview(null)}>
            {request.candidates.map((face) => {
              const name =
                props.controller.report?.snapshot.features.find(
                  (item) => item.id === face.featureId,
                )?.label ?? t("unnamed")
              return (
                <ContextMenuItem
                  key={`${face.featureId}:${face.outputRole}:${face.faceId}`}
                  onFocus={() => request.preview(face)}
                  onPointerMove={() => request.preview(face)}
                  onSelect={() => {
                    if (fresh) request.select(face)
                  }}
                >
                  {t("face", { name, number: face.faceOrdinal })}
                </ContextMenuItem>
              )
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : (
        <MenuAction
          label={t("selectOther")}
          icon={MousePointer2}
          disabled
          reason={t("noOverlaps")}
          onSelect={() => {}}
        />
      )}
    </>
  )
}

function ModelingActions({ props, menu }: { props: Props; menu: Menu }) {
  const { t, featureId, writeDisabled, command, run } = menu
  return (
    <>
      {command(editorCommandIds.createSketch, t("createSketch"))}
      {command(editorCommandIds.createExtrusion, t("extrude"))}
      {command(editorCommandIds.createDatumPlane, t("offsetPlane"))}
      {command(editorCommandIds.shellPart, t("shell"))}
      <MenuAction
        label={t("editFeature")}
        icon={PenLine}
        disabled={writeDisabled || !featureId}
        reason={!featureId ? t("noSelection") : null}
        onSelect={() => {
          if (featureId) void run(() => props.actions.editFeature(featureId), true)
        }}
      />
      <ProfileSketchAction
        controller={props.controller}
        featureId={featureId}
        disabled={writeDisabled}
        actions={props.actions}
        run={(action) => run(action, true)}
      />
    </>
  )
}

function BodyActions({ props, menu }: { props: Props; menu: Menu }) {
  const { t, part, body, featureId, writeDisabled, disabled, run, setDialog, removal, request } =
    menu
  return (
    <>
      {part ? (
        <PartAppearanceMenu
          controller={props.controller}
          partId={part.part.id}
          disabled={writeDisabled}
          onEdit={() => void run(() => setDialog("appearance"), true)}
          run={run}
        />
      ) : null}
      <MenuAction
        label={t("properties")}
        icon={Ruler}
        disabled={disabled || !body}
        reason={!body ? t("noSelection") : null}
        onSelect={() => void run(() => setDialog("properties"), true)}
      />
      <MenuAction
        label={t("saveMesh")}
        icon={Download}
        disabled={disabled || !part}
        reason={!part ? t("selectPart") : null}
        onSelect={() => void run(() => setDialog("export"), true)}
      />
      <ContextMenuSeparator />
      <MenuAction
        label={t("delete")}
        icon={Trash2}
        disabled={writeDisabled || !featureId}
        reason={!featureId ? t("noSelection") : null}
        onSelect={() => void run(() => removal.requestDelete(undefined, request?.focus), true)}
      />
      <VisibilityAction props={props} menu={menu} />
    </>
  )
}

function VisibilityAction({ props, menu }: { props: Props; menu: Menu }) {
  const { t, part, featureId, writeDisabled, disabled, run } = menu
  return (
    <>
      {" "}
      {part ? (
        <PartVisibilityAction
          key={part.part.id}
          part={part}
          controller={props.controller}
          visibility={props.partVisibility}
          disabled={writeDisabled}
          run={run}
        />
      ) : (
        <MenuAction
          label={t(featureId && props.hiddenFeatureIds.includes(featureId) ? "show" : "hide")}
          icon={Eye}
          disabled={disabled || !featureId}
          onSelect={() => {
            if (featureId)
              void run(() =>
                props.actions.setFeatureVisibility(
                  featureId,
                  props.hiddenFeatureIds.includes(featureId),
                ),
              )
          }}
        />
      )}
    </>
  )
}

function NavigationActions({ props, menu }: { props: Props; menu: Menu }) {
  const { t, featureId, disabled, reveal, command, run, request } = menu
  return (
    <>
      <MenuAction
        label={t("findBrowser")}
        icon={ListFilter}
        disabled={disabled || !featureId}
        onSelect={() => reveal("browser")}
      />
      <MenuAction
        label={t("findTimeline")}
        icon={Layers3}
        disabled={disabled || !featureId}
        onSelect={() => reveal("timeline")}
      />
      <ContextMenuSeparator />
      {command(editorCommandIds.pressPull, t("pressPull"))}
      {command(editorCommandIds.measure, t("measure"))}
      <ContextMenuSeparator />
      <MenuAction
        label={t("clear")}
        icon={X}
        disabled={disabled}
        onSelect={() =>
          void run(() => {
            request?.select(null)
            props.actions.clearSelection?.()
          })
        }
      />
    </>
  )
}

function ContextDialogs({ props, menu }: { props: Props; menu: Menu }) {
  const { dialog, body, part, writable, setDialog, request } = menu
  if (dialog === "properties")
    return body ? (
      <ModelPropertiesDialog
        controller={props.controller}
        body={body}
        part={part}
        onAppearance={part && writable ? () => setDialog("appearance") : undefined}
        onClose={menu.closeDialog}
      />
    ) : null
  if (!part || !body) return null
  if (dialog === "appearance")
    return (
      <PartAppearanceDialog
        key={part.part.id}
        controller={props.controller}
        partId={part.part.id}
        name={part.part.name}
        defaultColor={viewerBodyColor(body.featureId)}
        onClose={menu.closeDialog}
      />
    )
  if (dialog !== "export") return null
  return (
    <DocumentExportDialog
      controller={props.controller}
      initialPartId={part.part.id}
      meshOnly
      preferredFormat="stl"
      showTrigger={false}
      open
      onOpenChange={(open) => {
        if (!open) setDialog(null)
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        request?.focus.focus()
      }}
    />
  )
}

export function ViewportContextMenu(props: Props) {
  const menu = useViewportMenu(props)
  const target = useMenuTarget(props, menu)
  const { t, request, part, feature, fresh } = menu
  return (
    <ViewportContextTargetContext value={target}>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) request?.preview(null)
        }}
      >
        {props.children}
        <ContextMenuContent
          aria-label={t("label")}
          className="w-72"
          onCloseAutoFocus={menu.closeMenuFocus}
        >
          <ContextMenuLabel className="max-w-72 truncate">
            {part?.part.name ?? feature?.label ?? t("label")}
          </ContextMenuLabel>
          <SelectOtherActions props={props} menu={menu} />
          <ContextMenuSeparator />
          <ModelingActions props={props} menu={menu} />
          <ContextMenuSeparator />
          <BodyActions props={props} menu={menu} />
          <ContextMenuSeparator />
          <NavigationActions props={props} menu={menu} />
          {!fresh ? (
            <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
              {t("stale")}
            </p>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <ContextDialogs props={props} menu={menu} />
      {menu.removal.confirmation}
      {menu.error && !menu.appOwnsError ? <Alert>{menu.error}</Alert> : null}
    </ViewportContextTargetContext>
  )
}
