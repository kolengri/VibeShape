import type { PartId } from "@vibeshape/domain/identifiers"
import {
  type AppearancePresetId,
  appearanceColorSchema,
  appearancePresetIdSchema,
  appearancePresets,
  type PartAppearanceValue,
} from "@vibeshape/domain/part-appearance"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@vibeshape/ui/components/context-menu"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { SurfaceTextureIcon } from "@vibeshape/ui/components/icons"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useRef, useState } from "react"
import {
  commitAuthoredMetadata,
  type DocumentControllerState,
} from "../document/document-controller"
import { currentAuthoredSnapshot } from "./authored-tree-state"

function currentAppearance(controller: DocumentControllerState, partId: PartId) {
  const authority = currentAuthoredSnapshot(controller)
  return authority?.schemaVersion === 6
    ? (authority.partAppearances.find((item) => item.partId === partId)?.appearance ?? null)
    : null
}

export function PartAppearanceMenu({
  controller,
  partId,
  disabled,
  onEdit,
  run,
}: {
  controller: DocumentControllerState
  partId: PartId
  disabled: boolean
  onEdit: () => void
  run: (action: () => unknown) => void
}) {
  const t = useTranslations("app.viewportContext")
  const appearance = currentAppearance(controller, partId)
  const revision = currentAuthoredSnapshot(controller)?.revision
  const apply = async (value: PartAppearanceValue | null) => {
    if (revision === undefined) return
    const result = await commitAuthoredMetadata(revision, {
      kind: "part.set-appearance",
      partId,
      appearance: value,
    })
    if (!result.ok) throw new Error(result.diagnostic.message)
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <SurfaceTextureIcon aria-hidden="true" />
        {t("appearance")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-64">
        <ContextMenuItem onSelect={onEdit}>
          <SurfaceTextureIcon aria-hidden="true" />
          {t("editAppearance")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {appearancePresetIdSchema.options.map((id) => (
          <ContextMenuItem
            key={id}
            aria-current={appearance?.presetId === id ? "true" : undefined}
            onSelect={() => run(() => apply({ presetId: id }))}
          >
            <span
              className="size-5 shrink-0 rounded border border-border"
              style={{ backgroundColor: appearancePresets[id].color }}
              aria-hidden="true"
            />
            {t(`materials.${id}`)}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => run(() => apply(null))}>
          {t("resetAppearance")}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

type AppearanceDialogProps = {
  controller: DocumentControllerState
  partId: PartId
  name: string
  defaultColor: string
  onClose: () => void
}

type AppearanceEditBase = {
  documentId: string | undefined
  revision: number | undefined
  appearance: PartAppearanceValue | null
}

function appearanceEditStatus(
  controller: DocumentControllerState,
  base: AppearanceEditBase,
  pending: boolean,
) {
  const authority = currentAuthoredSnapshot(controller)
  const stale =
    !authority || authority.id !== base.documentId || authority.revision !== base.revision
  const disabled =
    stale ||
    pending ||
    controller.status !== "ready" ||
    controller.saveStatus !== "saved" ||
    controller.report?.mode !== "read-write"
  return { stale, disabled }
}

function usePartAppearanceEdit({
  controller,
  partId,
  defaultColor,
  onClose,
}: Omit<AppearanceDialogProps, "name">) {
  const t = useTranslations("app.viewportContext")
  const [base] = useState<AppearanceEditBase>(() => {
    const authority = currentAuthoredSnapshot(controller)
    return {
      documentId: authority?.id,
      revision: authority?.revision,
      appearance: currentAppearance(controller, partId),
    }
  })
  const [presetId, setPresetId] = useState<AppearancePresetId | null>(
    base.appearance?.presetId ?? null,
  )
  const [color, setColor] = useState(base.appearance?.color ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const { stale, disabled } = appearanceEditStatus(controller, base, pending)
  const displayedColor = color ?? (presetId ? appearancePresets[presetId].color : defaultColor)
  const apply = async (appearance: PartAppearanceValue | null) => {
    if (disabled || locked.current || base.revision === undefined) return
    locked.current = true
    setPending(true)
    setError(null)
    try {
      const result = await commitAuthoredMetadata(base.revision, {
        kind: "part.set-appearance",
        partId,
        appearance,
      })
      if (result.ok) onClose()
      else setError(result.diagnostic.message)
    } catch {
      setError(t("failed"))
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  const selectPreset = (value: string) => {
    const parsed = appearancePresetIdSchema.safeParse(value)
    setPresetId(parsed.success ? parsed.data : null)
    setColor(null)
  }
  const selectColor = (value: string) => {
    const parsed = appearanceColorSchema.safeParse(value)
    if (parsed.success) setColor(parsed.data)
  }
  return {
    presetId,
    color,
    displayedColor,
    pending,
    error,
    stale,
    disabled,
    apply,
    selectPreset,
    selectColor,
    resetColor: () => setColor(null),
  }
}

type AppearanceEditState = ReturnType<typeof usePartAppearanceEdit>

function PartAppearanceFields({ state }: { state: AppearanceEditState }) {
  const t = useTranslations("app.viewportContext")
  return (
    <>
      <NativeSelectField
        label={t("material")}
        value={state.presetId ?? "default"}
        disabled={state.disabled}
        onChange={(event) => state.selectPreset(event.currentTarget.value)}
      >
        <option value="default">{t("resetAppearance")}</option>
        {appearancePresetIdSchema.options.map((id) => (
          <option key={id} value={id}>
            {t(`materials.${id}`)}
          </option>
        ))}
      </NativeSelectField>
      <label className="grid gap-2 text-sm">
        {t("color")}
        <span className="flex items-center gap-3">
          <input
            aria-label={t("color")}
            type="color"
            className="h-10 w-16 cursor-pointer rounded border border-input bg-background p-1 disabled:cursor-default"
            value={state.displayedColor}
            disabled={state.disabled}
            onChange={(event) => state.selectColor(event.currentTarget.value)}
          />
          <output className="font-mono text-xs">{state.displayedColor.toUpperCase()}</output>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={state.disabled || state.color === null}
            onClick={state.resetColor}
          >
            {t("resetColor")}
          </Button>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">{t("appearanceDescription")}</p>
    </>
  )
}

function PartAppearanceFooter({
  state,
  onClose,
}: {
  state: AppearanceEditState
  onClose: () => void
}) {
  const t = useTranslations("app.viewportContext")
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="ghost"
        disabled={state.disabled}
        onClick={() => state.apply(null)}
      >
        {t("resetAppearance")}
      </Button>
      <Button type="button" variant="outline" disabled={state.pending} onClick={onClose}>
        {t("cancel")}
      </Button>
      <Button type="submit" disabled={state.disabled} isLoading={state.pending}>
        {t("apply")}
      </Button>
    </DialogFooter>
  )
}

export function PartAppearanceDialog(props: AppearanceDialogProps) {
  const t = useTranslations("app.viewportContext")
  const state = usePartAppearanceEdit(props)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !state.pending) props.onClose()
      }}
    >
      <DialogContent
        closeLabel={t("close")}
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          if (state.pending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (state.pending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("appearance")}</DialogTitle>
          <DialogDescription>{t("appearanceFor", { name: props.name })}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            void state.apply({
              presetId: state.presetId,
              ...(state.color ? { color: state.color } : {}),
            })
          }}
        >
          <DialogBody>
            <PartAppearanceFields state={state} />
            {state.stale ? <Alert>{t("stale")}</Alert> : null}
            {state.error ? <Alert>{state.error}</Alert> : null}
          </DialogBody>
          <PartAppearanceFooter state={state} onClose={props.onClose} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
