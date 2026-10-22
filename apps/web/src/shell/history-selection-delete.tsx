import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import { type KeyboardEvent, useRef, useState } from "react"
import { type DocumentControllerState, removeHistoryItems } from "../document/document-controller"
import { useReportApplicationError } from "./application-notices"
import { currentAuthoredSnapshot } from "./authored-tree-state"
import { historyDeleteKeyboardTarget } from "./history-delete-keyboard"
import {
  type HistorySelectionDeleteTarget,
  planHistoryRemoval,
  type RemovalPlan,
} from "./history-removal-plan"

export type { HistorySelectionDeleteTarget } from "./history-removal-plan"

function RemovalNames({
  label,
  names,
  remaining,
}: {
  label: string
  names: readonly string[]
  remaining: (count: number) => string
}) {
  if (names.length === 0) return null
  return (
    <section className="grid gap-1">
      <h3 className="text-sm font-medium">{label}</h3>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {names.slice(0, 8).map((name, index) => (
          <li key={`${index}:${name}`}>{name}</li>
        ))}
      </ul>
      {names.length > 8 && (
        <p className="text-xs text-muted-foreground">{remaining(names.length - 8)}</p>
      )}
    </section>
  )
}

function removalMessage(
  request: RemovalPlan,
  stale: boolean,
  appOwnsError: boolean,
  t: ReturnType<typeof useTranslations<"app.shell.selectionDelete">>,
) {
  if (request.blocked === "siblingsBlocked")
    return t("siblingsBlocked", { names: request.siblings.join(", ") })
  if (request.blocked) return t(request.blocked)
  return stale && !appOwnsError ? t("stale") : null
}

function RemovalConfirmation({
  request,
  pending,
  disabled,
  message,
  failure,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  request: RemovalPlan
  pending: boolean
  disabled: boolean
  message: string | null
  failure: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
  onCloseAutoFocus: (event: Event) => void
}) {
  const t = useTranslations("app.shell.selectionDelete")
  const remaining = (count: number) => t("remaining", { count })
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { count: request.names.length })}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <RemovalNames label={t("selected")} names={request.names} remaining={remaining} />
        <RemovalNames label={t("owners")} names={request.owners} remaining={remaining} />
        <RemovalNames label={t("dependents")} names={request.dependents} remaining={remaining} />
        {message && <Alert>{message}</Alert>}
        {failure && <Alert>{failure}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t("cancel")}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            isLoading={pending}
            disabled={disabled}
            onClick={onConfirm}
          >
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function removalRequestIsStale(
  request: RemovalPlan | null,
  authority: ReturnType<typeof currentAuthoredSnapshot>,
) {
  if (!request) return false
  return (
    !authority || authority.id !== request.documentId || authority.revision !== request.revision
  )
}

function removalAvailability(
  controller: DocumentControllerState | null | undefined,
  disabled: boolean,
  request: RemovalPlan | null,
) {
  const authority = controller ? currentAuthoredSnapshot(controller) : null
  const writable =
    !disabled &&
    controller?.status === "ready" &&
    controller.report?.mode === "read-write" &&
    controller.saveStatus === "saved"
  const stale = removalRequestIsStale(request, authority)

  return { authority, writable, stale }
}

export function useHistorySelectionDelete({
  controller,
  targets,
  disabled,
  onDeleted,
}: {
  controller: DocumentControllerState | null | undefined
  targets: readonly HistorySelectionDeleteTarget[]
  disabled: boolean
  onDeleted: () => void
}) {
  const t = useTranslations("app.shell.selectionDelete")
  const [request, setRequest] = useState<RemovalPlan | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const requestRef = useRef<RemovalPlan | null>(null)
  const pendingRef = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const returnTree = useRef<HTMLElement | null>(null)
  const { authority, writable, stale } = removalAvailability(controller, disabled, request)

  const appOwnsError = useReportApplicationError(failure ?? (stale ? t("stale") : null))

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, eventTargets = targets) => {
    if (
      !writable ||
      !authority ||
      requestRef.current ||
      pendingRef.current ||
      eventTargets.length === 0
    )
      return
    const focusTarget = historyDeleteKeyboardTarget(event)
    if (!focusTarget) return
    event.preventDefault()
    event.stopPropagation()
    returnFocus.current = focusTarget
    returnTree.current = focusTarget.closest<HTMLElement>('[role="tree"]')
    const next = planHistoryRemoval(authority, eventTargets)
    requestRef.current = next
    setFailure(null)
    setRequest(next)
  }
  const changeOpen = (open: boolean) => {
    if (open || pendingRef.current) return
    requestRef.current = null
    setRequest(null)
    setFailure(null)
  }
  const remove = async () => {
    if (!request || request.blocked || stale || !writable || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    try {
      const result = await removeHistoryItems(request.revision, request.targets, request.documentId)
      if (!result.ok) {
        setFailure(result.diagnostic.message)
        return
      }
      requestRef.current = null
      setRequest(null)
      onDeleted()
    } catch {
      setFailure(t("failed"))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const target = returnFocus.current?.isConnected
      ? returnFocus.current
      : returnTree.current?.querySelector<HTMLElement>('[role="treeitem"]:not([disabled])')
    target?.focus()
  }
  const confirmation = request ? (
    <RemovalConfirmation
      request={request}
      pending={pending}
      disabled={Boolean(request.blocked) || stale || !writable}
      message={removalMessage(request, stale, appOwnsError, t)}
      failure={appOwnsError ? null : failure}
      onOpenChange={changeOpen}
      onConfirm={remove}
      onCloseAutoFocus={restoreFocus}
    />
  ) : null
  return { onKeyDown, confirmation }
}
