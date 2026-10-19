import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import type { GeometryViewportSketchContext } from "./geometry-viewport"
import {
  currentReferenceRebuild,
  referencePickExcludedFeatures,
  referencePickHiddenBodies,
  referencePickPresentation,
} from "./reference-pick-presentation"
import { type ReferencePickCandidate, resolveReferencePick } from "./reference-picking"

type ReferencePickOwner = symbol
type ReferencePickRequest = Readonly<{
  owner: ReferencePickOwner
  label: string
  candidates: readonly ReferencePickCandidate[]
  onPick: (optionKey: string) => void
  returnFocus: HTMLElement | null
}>

type ProviderProps = Readonly<{
  activityKey: string | null
  children: ReactNode
  controller: DocumentControllerState
  editingFeatureId?: string | null
  hiddenFeatureIds: readonly string[]
  partVisibilityOverrides?: PartVisibilityOverrides | undefined
}>

type Scope = Readonly<{
  documentId: string | undefined
  revision: number | undefined
  activityKey: string | null
  response: ReturnType<typeof currentReferenceRebuild>
  visibilityKey: string
}>
type Environment = Readonly<{
  enabled: boolean
  scope: Scope
  presentation: Omit<Parameters<typeof referencePickPresentation>[0], "candidates">
}>
type ActiveRequest = ReferencePickRequest & Readonly<{ token: symbol; scope: Scope }>

type ReferencePicking = Readonly<{
  activeOwner: ReferencePickOwner | null
  enabled: boolean
  begin: (request: ReferencePickRequest) => void
  update: (request: ReferencePickRequest) => void
  cancel: (owner: ReferencePickOwner, restoreFocus?: boolean) => void
  viewportContext: GeometryViewportSketchContext | undefined
}>

const ReferencePickContext = createContext<ReferencePicking | null>(null)

export function useReferencePicking() {
  return useContext(ReferencePickContext)
}

function useReferenceEnvironment({
  activityKey,
  controller,
  editingFeatureId = null,
  hiddenFeatureIds,
  partVisibilityOverrides,
}: ProviderProps): Environment {
  const response = currentReferenceRebuild(controller)
  const documentId = controller.report?.snapshot.id
  const revision = controller.report?.snapshot.revision
  const excludedFeatureIds = useMemo(
    () => referencePickExcludedFeatures(controller, editingFeatureId),
    [controller.report?.snapshot.features, editingFeatureId],
  )
  const visibilityKey = JSON.stringify([
    [...hiddenFeatureIds].sort(),
    [...referencePickHiddenBodies(controller, partVisibilityOverrides)].sort(),
    [...excludedFeatureIds].sort(),
  ])
  const scope = useMemo<Scope>(
    () => ({ documentId, revision, activityKey, response, visibilityKey }),
    [documentId, revision, activityKey, response, visibilityKey],
  )
  return useMemo(
    () => ({
      scope,
      enabled: Boolean(
        activityKey &&
          response &&
          controller.status === "ready" &&
          controller.report?.mode === "read-write" &&
          controller.saveStatus !== "saving",
      ),
      presentation: { controller, excludedFeatureIds, hiddenFeatureIds, partVisibilityOverrides },
    }),
    [
      activityKey,
      controller,
      excludedFeatureIds,
      hiddenFeatureIds,
      partVisibilityOverrides,
      response,
      scope,
    ],
  )
}

function focusRequest(request: ReferencePickRequest) {
  if (request.returnFocus?.isConnected) request.returnFocus.focus()
}

function useReferenceRequestState(environment: Environment) {
  const environmentRef = useRef(environment)
  const requestRef = useRef<ActiveRequest | null>(null)
  const [request, setRequest] = useState<ActiveRequest | null>(null)

  const replace = useCallback((next: ActiveRequest | null) => {
    requestRef.current = next
    setRequest(next)
  }, [])

  const clear = useCallback(
    (expected: ActiveRequest, restoreFocus: boolean) => {
      if (requestRef.current?.token !== expected.token) return
      replace(null)
      if (restoreFocus) focusRequest(expected)
    },
    [replace],
  )

  useLayoutEffect(
    () => () => {
      requestRef.current = null
      environmentRef.current = { ...environmentRef.current, enabled: false }
    },
    [],
  )

  useLayoutEffect(() => {
    environmentRef.current = environment
    const current = requestRef.current
    if (current && (!environment.enabled || current.scope !== environment.scope))
      clear(current, false)
  }, [clear, environment])

  const cancelActive = useCallback(() => {
    const current = requestRef.current
    const live = environmentRef.current
    if (!current || current.scope !== live.scope || !live.enabled) return false
    clear(current, true)
    return true
  }, [clear])
  return { environmentRef, requestRef, request, clear, replace, cancelActive }
}

function useReferenceRequestActions({
  environmentRef,
  requestRef,
  clear,
  replace,
}: ReturnType<typeof useReferenceRequestState>) {
  const begin = useCallback(
    (input: ReferencePickRequest) => {
      const live = environmentRef.current
      if (!live.enabled) return
      const available = referencePickPresentation({
        ...live.presentation,
        candidates: input.candidates,
      })
      if (available.candidates.length === 0) return
      const next = { ...input, token: Symbol("reference-request"), scope: live.scope }
      replace(next)
    },
    [environmentRef, replace],
  )

  const cancel = useCallback(
    (owner: ReferencePickOwner, restoreFocus = false) => {
      const current = requestRef.current
      if (current?.owner === owner) clear(current, restoreFocus)
    },
    [clear, requestRef],
  )

  const update = useCallback(
    (input: ReferencePickRequest) => {
      const current = requestRef.current
      if (current?.owner !== input.owner) return
      const live = environmentRef.current
      if (!live.enabled || current.scope !== live.scope) {
        clear(current, false)
        return
      }
      const available = referencePickPresentation({
        ...live.presentation,
        candidates: input.candidates,
      })
      if (available.candidates.length === 0) {
        clear(current, false)
        return
      }
      const next = { ...current, ...input }
      replace(next)
    },
    [clear, environmentRef, replace, requestRef],
  )

  const pick = useCallback(
    (token: symbol, selection: ViewerSelection) => {
      const current = requestRef.current
      const live = environmentRef.current
      if (!current || current.token !== token || current.scope !== live.scope || !live.enabled)
        return
      const available = referencePickPresentation({
        ...live.presentation,
        candidates: current.candidates,
      })
      const candidate = resolveReferencePick(available.candidates, selection)
      if (!candidate) return
      // Clear synchronously before invoking form code, including re-entrant viewport callbacks.
      clear(current, false)
      current.onPick(candidate.id)
      if (!requestRef.current) focusRequest(current)
    },
    [clear, environmentRef, requestRef],
  )

  return { begin, cancel, update, pick }
}

function useReferenceViewportContext(
  environment: Environment,
  request: ActiveRequest | null,
  pick: (token: symbol, selection: ViewerSelection) => void,
) {
  const t = useTranslations("app.shell.viewport")
  const active = environment.enabled && request?.scope === environment.scope ? request : null
  const presentation = useMemo(
    () =>
      active
        ? referencePickPresentation({ ...environment.presentation, candidates: active.candidates })
        : null,
    [active, environment.presentation],
  )
  const viewportContext = useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!active || !presentation?.candidates.length) return undefined
    return {
      frame: null,
      mode: "orbit",
      faceIntersectionSelection: {
        consumeBackground: true,
        selectionMeshes: presentation.meshes,
        status: t("referenceSelection", { field: active.label }),
        isCandidateEligible: (selection) =>
          resolveReferencePick(presentation.candidates, selection) !== null,
        onSelect: (selection) => pick(active.token, selection),
      },
    }
  }, [active, pick, presentation, t])

  return { active, viewportContext }
}

/** One transient field request; the document and the owning form retain all durable state. */
export function ReferencePickProvider(props: ProviderProps) {
  const environment = useReferenceEnvironment(props)
  const state = useReferenceRequestState(environment)
  const { begin, cancel, update, pick } = useReferenceRequestActions(state)
  const { active, viewportContext } = useReferenceViewportContext(environment, state.request, pick)
  const value = useMemo<ReferencePicking>(
    () => ({
      activeOwner: active?.owner ?? null,
      enabled: environment.enabled,
      begin,
      update,
      cancel,
      viewportContext,
    }),
    [active?.owner, environment.enabled, begin, update, cancel, viewportContext],
  )
  return (
    <ReferencePickContext.Provider value={value}>
      <fieldset
        className="contents"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing)
            return
          if (!state.cancelActive()) return
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {props.children}
      </fieldset>
    </ReferencePickContext.Provider>
  )
}
