import {
  type ReferenceAxis,
  type ReferencePlane,
  referenceAxisSchema,
  referencePlaneSchema,
} from "@vibeshape/domain/reference-frame"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useId, useState } from "react"
import type { ReferenceFrameOption, ReferenceFrameOptions } from "./reference-frame-options"

type Props = {
  kind: "plane" | "axis"
  options: ReferenceFrameOptions
  value: ReferencePlane | ReferenceAxis | null | undefined
  selectedFace?: ViewerSelection | null | undefined
  onChange: (value: ReferencePlane | ReferenceAxis | null) => void
}
function explicitValues(value: Props["value"]) {
  const origin = value && "origin" in value ? value.origin : [0, 0, 0]
  const direction =
    value?.kind === "explicit-plane"
      ? value.normal
      : value?.kind === "explicit-axis"
        ? value.direction
        : [0, 0, 1]
  return [...origin, ...direction].map(String)
}
export function ReferenceSupportFields({ kind, options, value, selectedFace, onChange }: Props) {
  const t = useTranslations("app.referenceFrame")
  const fieldId = useId()
  const [fields, setFields] = useState(() => explicitValues(value))
  const choices: readonly ReferenceFrameOption<ReferencePlane | ReferenceAxis>[] =
    kind === "plane" ? options.planes : options.axes
  const matched = choices.find(({ support }) => JSON.stringify(support) === JSON.stringify(value))
  const explicit =
    value?.kind === "explicit-plane" || value?.kind === "explicit-axis" || value === null
  const selected =
    kind === "plane"
      ? options.planes.filter(
          ({ support, meshFaceId }) =>
            support.kind === "planar-face" &&
            support.reference.featureId === selectedFace?.featureId &&
            support.reference.outputRole === (selectedFace?.outputRole ?? "result") &&
            meshFaceId === selectedFace?.faceId,
        )
      : []
  const changeExplicit = (next: string[]) => {
    setFields(next)
    const numbers = next.map((raw) => (raw.trim() ? Number(raw) : Number.NaN))
    const origin = numbers.slice(0, 3),
      vector = numbers.slice(3)
    const length = Math.hypot(...vector)
    const direction = vector.map((component) => component / length)
    const parsed =
      kind === "plane"
        ? referencePlaneSchema.safeParse({ kind: "explicit-plane", origin, normal: direction })
        : referenceAxisSchema.safeParse({ kind: "explicit-axis", origin, direction })
    onChange(parsed.success ? parsed.data : null)
  }
  return (
    <fieldset className="grid gap-2 border-t pt-3">
      <legend className="text-xs font-medium">{t(kind === "plane" ? "plane" : "axis")}</legend>
      <label className="grid gap-1 text-sm">
        {t("source")}
        <select
          className="h-9 min-w-0 rounded-md border bg-background px-2"
          value={explicit ? "explicit" : (matched?.key ?? "origin")}
          onChange={(event) => {
            if (event.target.value === "explicit") changeExplicit(fields)
            else if (event.target.value === "origin")
              onChange(
                kind === "plane"
                  ? { kind: "origin-plane", plane: "XY" }
                  : { kind: "origin-axis", axis: "Z" },
              )
            else {
              const option = choices.find(({ key }) => key === event.target.value)
              if (option) onChange(option.support)
            }
          }}
        >
          <option value="origin">{t("origin")}</option>
          {choices.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
          <option value="explicit">{t("explicit")}</option>
        </select>
      </label>
      {kind === "plane" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selected.length !== 1}
          onClick={() => {
            const option = selected[0]
            if (option) onChange(option.support)
          }}
        >
          {t("useSelectedFace")}
        </Button>
      )}
      {value?.kind === "origin-plane" && (
        <label className="grid gap-1 text-sm">
          {t("plane")}
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={value.plane}
            onChange={(e) => {
              const parsed = referencePlaneSchema.safeParse({
                kind: "origin-plane",
                plane: e.target.value,
              })
              if (parsed.success) onChange(parsed.data)
            }}
          >
            {["XY", "XZ", "YZ"].map((plane) => (
              <option key={plane}>{plane}</option>
            ))}
          </select>
        </label>
      )}
      {value?.kind === "origin-axis" && (
        <label className="grid gap-1 text-sm">
          {t("axis")}
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={value.axis}
            onChange={(e) => {
              const parsed = referenceAxisSchema.safeParse({
                kind: "origin-axis",
                axis: e.target.value,
              })
              if (parsed.success) onChange(parsed.data)
            }}
          >
            {["X", "Y", "Z"].map((axis) => (
              <option key={axis}>{axis}</option>
            ))}
          </select>
        </label>
      )}
      {explicit && (
        <div className="grid grid-cols-3 gap-2">
          {fields.map((field, index) => (
            <label
              htmlFor={`${fieldId}-${index}`}
              key={index < 3 ? `origin-${index}` : `direction-${index}`}
              className="grid gap-1 text-xs"
            >
              {t(index < 3 ? "originCoordinate" : "directionCoordinate", {
                axis: ["X", "Y", "Z"][index % 3] ?? "X",
              })}
              <Input
                id={`${fieldId}-${index}`}
                type="number"
                step="any"
                value={field}
                aria-invalid={value === null}
                onChange={(event) =>
                  changeExplicit(fields.map((old, i) => (i === index ? event.target.value : old)))
                }
              />
            </label>
          ))}
        </div>
      )}
      {value === null && (
        <p role="alert" className="text-xs text-destructive">
          {t("invalid")}
        </p>
      )}
    </fieldset>
  )
}
