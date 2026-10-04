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
import { type ReactNode, useId, useState } from "react"
import type { ReferenceFrameOption, ReferenceFrameOptions } from "./reference-frame-options"

type Props = {
  kind: "plane" | "axis"
  options: ReferenceFrameOptions
  value: ReferencePlane | ReferenceAxis | null | undefined
  selectedFace?: ViewerSelection | null | undefined
  onChange: (value: ReferencePlane | ReferenceAxis | null) => void
}
type SelectionProps<T> = {
  options?: ReferenceFrameOptions | undefined
  value: T | null | undefined
  selectedFace?: ViewerSelection | null | undefined
  onChange: (value: T | null) => void
  children: ReactNode
}
export function ReferencePlaneSelection(props: SelectionProps<ReferencePlane>) {
  return (
    <>
      {props.options && (
        <ReferenceSupportFields
          kind="plane"
          options={props.options}
          value={props.value}
          selectedFace={props.selectedFace}
          onChange={(support) => {
            const parsed = referencePlaneSchema.safeParse(support)
            if (support === null || parsed.success)
              props.onChange(parsed.success ? parsed.data : null)
          }}
        />
      )}
      {props.value === undefined && props.children}
    </>
  )
}
export function ReferenceAxisSelection(props: SelectionProps<ReferenceAxis>) {
  return (
    <>
      {props.options && (
        <ReferenceSupportFields
          kind="axis"
          options={props.options}
          value={props.value}
          selectedFace={props.selectedFace}
          onChange={(support) => {
            const parsed = referenceAxisSchema.safeParse(support)
            if (support === null || parsed.success)
              props.onChange(parsed.success ? parsed.data : null)
          }}
        />
      )}
      {props.value === undefined && props.children}
    </>
  )
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
type Choices = readonly ReferenceFrameOption<ReferencePlane | ReferenceAxis>[]
function referenceSource(value: Props["value"], choices: Choices) {
  if (value == null) return value === null ? "explicit" : "origin"
  if ("origin" in value) return "explicit"
  if (value.kind === "origin-plane" || value.kind === "origin-axis") return "origin"
  return (
    choices.find(({ support }) => JSON.stringify(support) === JSON.stringify(value))?.key ??
    "selected"
  )
}
function explicitSupport(kind: Props["kind"], fields: readonly string[]) {
  const numbers = fields.map((raw) => (raw.trim() ? Number(raw) : Number.NaN))
  const origin = numbers.slice(0, 3),
    vector = numbers.slice(3)
  const length = Math.hypot(...vector)
  const direction = vector.map((component) => component / length)
  const parsed =
    kind === "plane"
      ? referencePlaneSchema.safeParse({ kind: "explicit-plane", origin, normal: direction })
      : referenceAxisSchema.safeParse({ kind: "explicit-axis", origin, direction })
  return parsed.success ? parsed.data : null
}
function selectReference(
  key: string,
  kind: Props["kind"],
  value: Props["value"],
  choices: Choices,
  onChange: Props["onChange"],
) {
  if (key === "explicit") onChange(explicitSupport(kind, explicitValues(value)))
  else if (key === "origin")
    onChange(
      kind === "plane" ? { kind: "origin-plane", plane: "XY" } : { kind: "origin-axis", axis: "Z" },
    )
  else {
    const option = choices.find((choice) => choice.key === key)
    if (option) onChange(option.support)
  }
}
function SelectedPlanarFaceButton({
  options,
  selectedFace,
  onChange,
}: Pick<Props, "options" | "selectedFace" | "onChange">) {
  const t = useTranslations("app.referenceFrame")
  const selected = options.planes.filter(
    ({ support, meshFaceId }) =>
      support.kind === "planar-face" &&
      support.reference.featureId === selectedFace?.featureId &&
      support.reference.outputRole === (selectedFace?.outputRole ?? "result") &&
      meshFaceId === selectedFace?.faceId,
  )
  return (
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
  )
}
function OriginSupportControls({ value, onChange }: Pick<Props, "value" | "onChange">) {
  const t = useTranslations("app.referenceFrame")
  if (value?.kind !== "origin-plane" && value?.kind !== "origin-axis") return null
  const plane = value.kind === "origin-plane"
  return (
    <label className="grid gap-1 text-sm">
      {t(plane ? "plane" : "axis")}
      <select
        className="h-9 rounded-md border bg-background px-2"
        value={plane ? value.plane : value.axis}
        onChange={(event) => {
          const parsed = plane
            ? referencePlaneSchema.safeParse({ kind: "origin-plane", plane: event.target.value })
            : referenceAxisSchema.safeParse({ kind: "origin-axis", axis: event.target.value })
          if (parsed.success) onChange(parsed.data)
        }}
      >
        {(plane ? ["XY", "XZ", "YZ"] : ["X", "Y", "Z"]).map((axis) => (
          <option key={axis}>{axis}</option>
        ))}
      </select>
    </label>
  )
}
function ExplicitReferenceSupportFields({
  kind,
  value,
  onChange,
}: Pick<Props, "kind" | "value" | "onChange">) {
  const t = useTranslations("app.referenceFrame")
  const fieldId = useId()
  const [fields, setFields] = useState(() => explicitValues(value))
  return (
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
            onChange={(event) => {
              const next = fields.map((old, i) => (i === index ? event.target.value : old))
              setFields(next)
              onChange(explicitSupport(kind, next))
            }}
          />
        </label>
      ))}
    </div>
  )
}
function ReferenceSupportFields({ kind, options, value, selectedFace, onChange }: Props) {
  const t = useTranslations("app.referenceFrame")
  // Preview replaces rendered source meshes and can clear the viewport selection.
  const [startingFace] = useState(selectedFace)
  const choices: Choices = kind === "plane" ? options.planes : options.axes
  const source = referenceSource(value, choices)
  return (
    <fieldset className="grid gap-2 border-t pt-3">
      <legend className="text-xs font-medium">{t(kind === "plane" ? "plane" : "axis")}</legend>
      <label className="grid gap-1 text-sm">
        {t("source")}
        <select
          className="h-9 min-w-0 rounded-md border bg-background px-2"
          value={source}
          onChange={(event) => selectReference(event.target.value, kind, value, choices, onChange)}
        >
          <option value="origin">{t("origin")}</option>
          {source === "selected" && <option value="selected">{t("selectedReference")}</option>}
          {choices.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
          <option value="explicit">{t("explicit")}</option>
        </select>
      </label>
      {kind === "plane" && (
        <SelectedPlanarFaceButton
          options={options}
          selectedFace={selectedFace ?? startingFace}
          onChange={onChange}
        />
      )}
      <OriginSupportControls value={value} onChange={onChange} />
      {source === "explicit" && (
        <ExplicitReferenceSupportFields kind={kind} value={value} onChange={onChange} />
      )}
      {value === null && (
        <p role="alert" className="text-xs text-destructive">
          {t("invalid")}
        </p>
      )}
    </fieldset>
  )
}
