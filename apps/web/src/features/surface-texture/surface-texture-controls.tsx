import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { useEffect, useId, useState } from "react"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"

export function TextureNumberField({
  label,
  value,
  min,
  max,
  step = "any",
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number | "any"
  onChange: (value: number) => void
}) {
  const id = useId()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const invalid =
    text === "" || !Number.isFinite(Number(text)) || Number(text) < min || Number(text) > max
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        required
        aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (
            next !== "" &&
            Number.isFinite(Number(next)) &&
            Number(next) >= min &&
            Number(next) <= max
          )
            onChange(Number(next))
        }}
      />
    </Field>
  )
}

export function SurfaceTextureControls({
  layer,
  update,
}: {
  layer: SurfaceTextureLayer
  update: (patch: Partial<SurfaceTextureLayer>) => void
}) {
  const t = useTranslations("app.surfaceTexture")
  const [linked, setLinked] = useState(layer.sizeUMm === layer.sizeVMm)
  const directionId = useId()
  const mappingId = useId()
  const axisId = useId()
  const blendId = useId()
  return (
    <div className="grid gap-2">
      <TextureNumberField
        label={t("height")}
        value={layer.heightMm}
        min={0.01}
        max={100}
        step={0.01}
        onChange={(heightMm) => update({ heightMm })}
      />
      <Field>
        <FieldLabel htmlFor={directionId}>{t("direction")}</FieldLabel>
        <NativeSelect
          id={directionId}
          value={layer.direction}
          onChange={(event) =>
            update({ direction: event.target.value as SurfaceTextureLayer["direction"] })
          }
        >
          {(["outward", "inward", "centered"] as const).map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <TextureNumberField
        label={t("width")}
        value={layer.sizeUMm}
        min={0.02}
        max={100_000}
        onChange={(sizeUMm) => update({ sizeUMm, ...(linked ? { sizeVMm: sizeUMm } : {}) })}
      />
      <TextureNumberField
        label={t("length")}
        value={layer.sizeVMm}
        min={0.02}
        max={100_000}
        onChange={(sizeVMm) => update({ sizeVMm, ...(linked ? { sizeUMm: sizeVMm } : {}) })}
      />
      <BooleanParameterField
        label={t("linkedSize")}
        checked={linked}
        onChange={(event) => {
          setLinked(event.target.checked)
          if (event.target.checked) update({ sizeVMm: layer.sizeUMm })
        }}
      />
      <TextureNumberField
        label={t("rotation")}
        value={layer.rotationDeg}
        min={-360}
        max={360}
        step={1}
        onChange={(rotationDeg) => update({ rotationDeg })}
      />
      <Field>
        <FieldLabel htmlFor={mappingId}>{t("mapping")}</FieldLabel>
        <NativeSelect
          id={mappingId}
          value={layer.mapping.kind}
          onChange={(event) =>
            update({
              mapping: {
                ...layer.mapping,
                kind: event.target.value as SurfaceTextureLayer["mapping"]["kind"],
              },
            })
          }
        >
          {(["triplanar", "planar", "cylindrical", "spherical"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`projections.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {layer.mapping.kind !== "triplanar" && (
        <Field>
          <FieldLabel htmlFor={axisId}>{t("axis")}</FieldLabel>
          <NativeSelect
            id={axisId}
            value={layer.mapping.axis}
            onChange={(event) =>
              update({ mapping: { ...layer.mapping, axis: event.target.value as "x" | "y" | "z" } })
            }
          >
            {["x", "y", "z"].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <details className="border-t pt-2">
        <summary className="cursor-pointer text-xs font-medium">{t("advanced")}</summary>
        <div className="mt-2 grid gap-2">
          <BooleanParameterField
            label={t("invert")}
            checked={layer.invert}
            onChange={(event) => update({ invert: event.target.checked })}
          />
          <TextureNumberField
            label={t("offsetU")}
            value={layer.offsetUMm}
            min={-100_000}
            max={100_000}
            onChange={(offsetUMm) => update({ offsetUMm })}
          />
          <TextureNumberField
            label={t("offsetV")}
            value={layer.offsetVMm}
            min={-100_000}
            max={100_000}
            onChange={(offsetVMm) => update({ offsetVMm })}
          />
          <TextureNumberField
            label={t("boundaryFade")}
            value={layer.boundaryFadeMm}
            min={0}
            max={100_000}
            onChange={(boundaryFadeMm) => update({ boundaryFadeMm })}
          />
          <Field>
            <FieldLabel htmlFor={blendId}>{t("overlap")}</FieldLabel>
            <NativeSelect
              id={blendId}
              value={layer.blend}
              onChange={(event) =>
                update({ blend: event.target.value as SurfaceTextureLayer["blend"] })
              }
            >
              <option value="replace">{t("replace")}</option>
              <option value="add">{t("add")}</option>
            </NativeSelect>
          </Field>
        </div>
      </details>
    </div>
  )
}
