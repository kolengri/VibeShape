import type { DocumentDisplayUnits } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  HideIcon,
  MirrorIcon,
  SectionPlaneXyIcon,
  SectionPlaneXzIcon,
  SectionPlaneYzIcon,
  SectionViewIcon,
} from "@vibeshape/ui/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@vibeshape/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type { ViewerMesh, ViewerSection } from "@vibeshape/viewer/three-viewport"
import { useId, useState } from "react"
import {
  defaultLengthExpression,
  useDocumentDisplayUnits,
} from "../document/document-display-units"
import { LengthExpressionField } from "../features/part-design/length-expression-field"
import { parsePrimitiveLengthExpression } from "../features/part-design/primitive-form"

const sectionPlanes = [
  { axis: null, plane: null, icon: HideIcon },
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

function useSectionControlDraft(
  section: ViewerSection | null,
  unit: DocumentDisplayUnits["length"],
  onChange: (section: ViewerSection | null) => void,
) {
  const sourceOffset = section?.offset
  const sourceFlipped = section?.flipped
  const currentOffset = sourceOffset ?? 0
  const [draft, setDraft] = useState(() => ({
    expression: defaultLengthExpression(currentOffset, unit),
    sourceOffset,
    unit,
  }))
  const [flipped, setFlipped] = useState(sourceFlipped ?? false)
  if (sourceFlipped !== undefined && sourceFlipped !== flipped) setFlipped(sourceFlipped)
  if (draft.sourceOffset !== sourceOffset || draft.unit !== unit) {
    setDraft({ expression: defaultLengthExpression(currentOffset, unit), sourceOffset, unit })
  }
  function setOffset(expression: string) {
    setDraft((current) => ({ ...current, expression }))
  }
  function changeSection(next: ViewerSection | null) {
    // Preserve authored units until the section changes externally, such as by dragging its handle.
    setDraft((current) => ({ ...current, sourceOffset: next?.offset }))
    onChange(next)
  }
  return { offset: draft.expression, setOffset, flipped, setFlipped, changeSection }
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
  const [open, setOpen] = useState(false)
  const axisId = useId()
  const { length: unit } = useDocumentDisplayUnits()
  const { offset, setOffset, flipped, setFlipped, changeSection } = useSectionControlDraft(
    section,
    unit,
    onChange,
  )
  const invalidMessage = t("invalid")
  function parseOffset(value: string) {
    return parsePrimitiveLengthExpression(
      value,
      [],
      {
        invalidExpression: invalidMessage,
        invalidDimension: invalidMessage,
        invalidRange: invalidMessage,
      },
      (quantity) => Math.abs(quantity.value) <= 100_000,
      unit,
    )
  }
  const parsedOffset = parseOffset(offset)
  if (disabled || meshes.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <TooltipContent onEscapeKeyDown={() => setOpen(false)}>{t("title")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="grid max-h-[var(--radix-popover-content-available-height)] w-64 gap-3 overflow-y-auto p-3 text-xs"
        aria-label={t("title")}
      >
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t("axis")}</legend>
          <div className="grid grid-cols-4 gap-2">
            {sectionPlanes.map(({ axis: next, plane, icon: Icon }) => {
              const label = next
                ? t("planeLabel", { plane, axis: next.toUpperCase() })
                : t("disabled")
              return (
                <label key={next ?? "off"} className="relative cursor-pointer">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <input
                        type="radio"
                        name={axisId}
                        value={next ?? "off"}
                        checked={(section?.axis ?? null) === next}
                        aria-label={label}
                        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                        onChange={() => {
                          if (next === null) {
                            changeSection(null)
                            return
                          }
                          const center = modelMidpoint(meshes, next)
                          setOffset(defaultLengthExpression(center, unit))
                          changeSection({ axis: next, offset: center, flipped })
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent onEscapeKeyDown={() => setOpen(false)}>{label}</TooltipContent>
                  </Tooltip>
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-md border border-input bg-background p-2",
                      "peer-hover:bg-accent peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-8" />
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
        <LengthExpressionField
          id={`${axisId}-offset`}
          label={t("offset")}
          description=""
          suggestions={[]}
          value={offset}
          error={parsedOffset.ok ? undefined : parsedOffset.message}
          onValueChange={(value) => {
            setOffset(value)
            const parsed = parseOffset(value)
            if (parsed.ok && section) {
              changeSection({ ...section, offset: parsed.quantity.value })
            }
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={flipped ? "secondary" : "ghost"}
              aria-label={t("flip")}
              aria-pressed={flipped}
              onClick={() => {
                setFlipped(!flipped)
                if (section) changeSection({ ...section, flipped: !flipped })
              }}
            >
              <MirrorIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent onEscapeKeyDown={() => setOpen(false)}>{t("flip")}</TooltipContent>
        </Tooltip>
      </PopoverContent>
    </Popover>
  )
}
