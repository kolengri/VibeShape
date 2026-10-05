import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@vibeshape/ui/components/popover"
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
  const [axis, setAxis] = useState<ViewerSection["axis"]>(section?.axis ?? "z")
  const [offset, setOffset] = useState(String(section?.offset ?? 0))
  const [flipped, setFlipped] = useState(section?.flipped ?? false)
  const invalid =
    offset.trim() === "" || !Number.isFinite(Number(offset)) || Math.abs(Number(offset)) > 100_000
  if (disabled || meshes.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant={section ? "secondary" : "ghost"}>
          {t("title")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-56 gap-2 p-3 text-xs" aria-label={t("title")}>
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
      </PopoverContent>
    </Popover>
  )
}
