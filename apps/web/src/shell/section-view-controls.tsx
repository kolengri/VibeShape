import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  SectionPlaneXyIcon,
  SectionPlaneXzIcon,
  SectionPlaneYzIcon,
  SectionViewIcon,
} from "@vibeshape/ui/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@vibeshape/ui/components/popover"
import { TextField } from "@vibeshape/ui/components/text-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type { ViewerMesh, ViewerSection } from "@vibeshape/viewer/three-viewport"
import { useId, useState } from "react"

const sectionPlanes = [
  { axis: "z", plane: "XY", icon: SectionPlaneXyIcon },
  { axis: "y", plane: "XZ", icon: SectionPlaneXzIcon },
  { axis: "x", plane: "YZ", icon: SectionPlaneYzIcon },
] as const

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

function useSectionControlDraft(section: ViewerSection | null) {
  const initial: ViewerSection = section ?? { axis: "z", offset: 0, flipped: false }
  const [axis, setAxis] = useState(initial.axis)
  const [offset, setOffset] = useState(String(initial.offset))
  const [flipped, setFlipped] = useState(initial.flipped)
  const [previousSection, setPreviousSection] = useState(section)
  if (section !== previousSection) {
    setPreviousSection(section)
    if (
      section &&
      (section.axis !== previousSection?.axis || section.offset !== previousSection?.offset)
    ) {
      setAxis(section.axis)
      setOffset(String(section.offset))
    }
    if (section) setFlipped(section.flipped)
  }
  return { axis, setAxis, offset, setOffset, flipped, setFlipped }
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
  const { axis, setAxis, offset, setOffset, flipped, setFlipped } = useSectionControlDraft(section)
  const invalid =
    offset.trim() === "" || !Number.isFinite(Number(offset)) || Math.abs(Number(offset)) > 100_000
  if (disabled || meshes.length === 0) return null
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={section ? "secondary" : "ghost"}
              aria-label={t("title")}
              aria-pressed={section !== null}
              dropdown
            >
              <SectionViewIcon aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("title")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="grid max-h-[var(--radix-popover-content-available-height)] w-64 gap-3 overflow-y-auto p-3 text-xs"
        aria-label={t("title")}
      >
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
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">{t("axis")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {sectionPlanes.map(({ axis: next, plane, icon: Icon }) => (
              <label key={next} className="relative cursor-pointer">
                <input
                  type="radio"
                  name={axisId}
                  value={next}
                  checked={axis === next}
                  aria-label={t("planeLabel", { plane, axis: next.toUpperCase() })}
                  className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                  onChange={() => {
                    setAxis(next)
                    const center = modelMidpoint(meshes, next)
                    setOffset(String(center))
                    if (section) onChange({ axis: next, offset: center, flipped })
                  }}
                />
                <span
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border border-input bg-background px-2 py-2",
                    "peer-hover:bg-accent peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary",
                    "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                  )}
                >
                  <Icon className="size-8" />
                  <span className="font-medium">{plane}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
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
        <p className="text-muted-foreground">{t("dragHint")}</p>
        <p className="text-muted-foreground">{t("description")}</p>
      </PopoverContent>
    </Popover>
  )
}
