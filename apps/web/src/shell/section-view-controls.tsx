import { useTranslations } from "@vibeshape/i18n"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { TextField } from "@vibeshape/ui/components/text-field"
import type { ViewerMesh, ViewerSection } from "@vibeshape/viewer/three-viewport"
import { useId, useState } from "react"

function modelMidpoint(meshes: readonly ViewerMesh[], axis: ViewerSection["axis"]) {
  const coordinate = { x: 0, y: 1, z: 2 }[axis]
  let min = Infinity
  let max = -Infinity
  for (const mesh of meshes) {
    if (mesh.appearance === "datum") continue
    for (let i = coordinate; i < mesh.positions.length; i += 3) {
      const value = mesh.positions[i]
      if (value === undefined) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  return Number.isFinite(min + max) ? (min + max) / 2 : 0
}

export function SectionViewControls({
  disabled,
  section,
  onChange,
  meshes,
}: {
  disabled: boolean
  section: ViewerSection | null
  onChange: (section: ViewerSection | null) => void
  meshes: readonly ViewerMesh[]
}) {
  const t = useTranslations("app.sectionView")
  const axisId = useId()
  const [axis, setAxis] = useState<ViewerSection["axis"]>("z")
  const [offset, setOffset] = useState("0")
  const [flipped, setFlipped] = useState(false)
  const invalid =
    offset.trim() === "" || !Number.isFinite(Number(offset)) || Math.abs(Number(offset)) > 100_000
  if (disabled || meshes.length === 0) return null
  return (
    <details className="absolute right-3 top-24 z-10 max-w-56 rounded-md border bg-background/95 p-2 text-xs shadow-sm">
      <summary className="cursor-pointer font-medium">{t("title")}</summary>
      <div className="mt-2 grid gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={section !== null}
            onChange={(event) => {
              if (!event.currentTarget.checked) {
                onChange(null)
                return
              }
              const center = modelMidpoint(meshes, axis)
              setOffset(String(center))
              onChange({ axis, offset: center, flipped })
            }}
          />
          {t("enabled")}
        </label>
        <label htmlFor={axisId}>{t("axis")}</label>
        <NativeSelect
          id={axisId}
          value={axis}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (next !== "x" && next !== "y" && next !== "z") return
            setAxis(next)
            const center = modelMidpoint(meshes, next)
            setOffset(String(center))
            if (section) onChange({ axis: next, offset: center, flipped })
          }}
        >
          <option value="x">YZ / X</option>
          <option value="y">XZ / Y</option>
          <option value="z">XY / Z</option>
        </NativeSelect>
        <TextField
          label={t("offset")}
          type="number"
          step="any"
          value={offset}
          error={invalid ? t("invalid") : undefined}
          onChange={(event) => {
            const value = event.currentTarget.value
            setOffset(value)
            const number = Number(value)
            if (value.trim() && Number.isFinite(number) && Math.abs(number) <= 100_000 && section) {
              onChange({ axis, offset: number, flipped })
            }
          }}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={flipped}
            onChange={(event) => {
              setFlipped(event.currentTarget.checked)
              if (section) onChange({ ...section, flipped: event.currentTarget.checked })
            }}
          />
          {t("flip")}
        </label>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
    </details>
  )
}
