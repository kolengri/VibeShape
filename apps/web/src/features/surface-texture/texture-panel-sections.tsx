import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Eye, EyeOff, Trash2 } from "@vibeshape/ui/components/icons"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { useId, useMemo, useRef } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { terminalModelBodies } from "../part-design/model-bodies"
import { TextureNumberField } from "./surface-texture-controls"
import { TextureThumbnail } from "./texture-gallery"
import type { useTextureDraft } from "./use-texture-draft"

export type TextureDraftState = ReturnType<typeof useTextureDraft>
export function TextureBodyField({
  controller,
  state,
}: {
  controller: DocumentControllerState
  state: TextureDraftState
}) {
  const t = useTranslations("app.surfaceTexture")
  const bodyId = useId()
  const { draft } = state
  const report = controller.report
  const bodies = useMemo(
    () =>
      report?.rebuild.ok
        ? (terminalModelBodies(report.snapshot.features, report.rebuild.response) ?? [])
        : [],
    [report],
  )
  return (
    <Field>
      <FieldLabel htmlFor={bodyId}>{t("body")}</FieldLabel>
      <NativeSelect
        id={bodyId}
        value={draft ? `${draft.featureId}:${draft.outputRole}` : ""}
        onChange={(event) => {
          const body = bodies.find(
            ({ geometry }) =>
              `${geometry.featureId}:${geometry.outputRole ?? "result"}` === event.target.value,
          )
          if (body) {
            state.chooseBody({
              featureId: body.feature.id,
              outputRole: body.geometry.outputRole ?? "result",
            })
          }
        }}
      >
        <option value="" disabled>
          {t("selectBody")}
        </option>
        {bodies.map(({ feature, geometry }) => (
          <option
            key={`${feature.id}:${geometry.outputRole}`}
            value={`${feature.id}:${geometry.outputRole ?? "result"}`}
          >
            {feature.label ?? t("unnamedBody")}
            {geometry.outputRole && geometry.outputRole !== "result"
              ? ` · ${geometry.outputRole}`
              : ""}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}
export function TextureLayerList({ state }: { state: TextureDraftState }) {
  const t = useTranslations("app.surfaceTexture")
  const { draft, update } = state
  if (!draft) return null
  return (
    <section aria-label={t("layers")} className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium">{t("layers")}</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={draft.layers.length >= 4}
          onClick={state.addLayer}
        >
          {t("addLayer")}
        </Button>
      </div>
      {draft.layers.map((item, index) => (
        <div key={item.id} className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={item.id === draft.selectedId ? "secondary" : "ghost"}
            aria-pressed={item.id === draft.selectedId}
            className="min-w-0 flex-1 justify-start"
            onClick={() => {
              state.selectLayer(item.id)
            }}
          >
            <span className="truncate">
              {t("layer", { number: index + 1 })} ·{" "}
              {item.map.kind === "builtin" ? t(`patterns.${item.map.pattern}`) : t("customImage")}
            </span>
          </Button>
          {item.id === draft.selectedId && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={item.enabled ? t("hideLayer") : t("showLayer")}
              aria-pressed={item.enabled}
              onClick={() => update({ enabled: !item.enabled })}
            >
              {item.enabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </Button>
          )}
        </div>
      ))}
    </section>
  )
}
export function TextureRegionControls({ state }: { state: TextureDraftState }) {
  const t = useTranslations("app.surfaceTexture")
  const { draft, layer, update } = state
  if (!layer) return null
  return (
    <section aria-label={t("surfaces")} className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium">{t("surfaces")}</h3>
      <p className="text-xs text-muted-foreground">
        {layer.target.kind === "body"
          ? t("entireBody")
          : t("selectedFaces", { count: layer.target.refs.length })}
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant={state.pickMode === "faces" ? "secondary" : "outline"}
          aria-pressed={state.pickMode === "faces"}
          onClick={() => state.setPickMode(state.pickMode === "faces" ? "navigate" : "faces")}
        >
          {t("pickFaces")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            update({
              target: { kind: "body", outputRole: draft?.outputRole ?? "result" },
              mask: { base: "all", strokes: [] },
            })
            state.setPickMode("navigate")
          }}
        >
          {t("fillBody")}
        </Button>
      </div>
      {layer.target.kind === "faces" && (
        <ul className="grid gap-1">
          {layer.target.refs.map((ref, index) => (
            <li
              key={JSON.stringify(ref)}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span>{t("face", { number: index + 1 })}</span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={layer.target.kind === "faces" && layer.target.refs.length === 1}
                aria-label={t("removeFace", { number: index + 1 })}
                onClick={() => {
                  if (layer.target.kind === "faces")
                    update({
                      target: {
                        ...layer.target,
                        refs: layer.target.refs.filter((_, i) => i !== index),
                      },
                    })
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1">
        {(["navigate", "paint", "erase"] as const).map((mode) => (
          <Button
            type="button"
            key={mode}
            size="sm"
            variant={state.pickMode === mode ? "secondary" : "outline"}
            aria-pressed={state.pickMode === mode}
            onClick={() => {
              if (mode === "paint" && layer.mask.strokes.length === 0)
                update({ mask: { base: "empty", strokes: [] } })
              state.setPickMode(mode)
            }}
          >
            {t(mode)}
          </Button>
        ))}
      </div>
      {(state.pickMode === "paint" || state.pickMode === "erase") && (
        <>
          <p className="text-xs text-muted-foreground">{t("paintHint")}</p>
          <TextureNumberField
            label={t("brushRadius")}
            value={state.radiusMm}
            min={0.1}
            max={1000}
            onChange={state.setRadiusMm}
          />
          <TextureNumberField
            label={t("hardness")}
            value={state.hardness}
            min={0}
            max={1}
            step={0.05}
            onChange={state.setHardness}
          />
        </>
      )}
      {layer.mask.strokes.length >= 2048 && <Alert>{t("paintLimit")}</Alert>}
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!state.maskUndoAvailable}
          onClick={state.undoMask}
        >
          {t("undoStroke")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => update({ mask: { base: "all", strokes: [] } })}
        >
          {t("resetMask")}
        </Button>
      </div>
    </section>
  )
}
export function TextureMapField({
  state,
  uploading,
  onBrowse,
  onUpload,
}: {
  state: TextureDraftState
  uploading: boolean
  onBrowse: () => void
  onUpload: (file: File) => Promise<void>
}) {
  const t = useTranslations("app.surfaceTexture")
  const { layer } = state
  const uploadRef = useRef<HTMLInputElement>(null)
  if (!layer) return null
  return (
    <section aria-label={t("texture")} className="grid gap-3 border-t pt-3">
      <div className="flex items-center gap-3">
        <TextureThumbnail map={layer.map} className="w-16 shrink-0" />
        <div className="grid gap-1">
          <span className="text-xs font-medium">
            {layer.map.kind === "builtin" ? t(`patterns.${layer.map.pattern}`) : t("customImage")}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => onBrowse()}>
            {t("browse")}
          </Button>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        isLoading={uploading}
        onClick={() => uploadRef.current?.click()}
      >
        {t("upload")}
      </Button>
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label={t("upload")}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onUpload(file)
          event.target.value = ""
        }}
      />
    </section>
  )
}
