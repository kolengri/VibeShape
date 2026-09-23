import { canonicalJson, type SketchProfileSelector } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Link2, PenLine } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"

export function HistoryProfileSources({
  profiles,
  labelsByRef,
  onPreview,
  dependencyDescription,
}: {
  profiles: readonly SketchProfileSelector[]
  labelsByRef: ReadonlyMap<string, string>
  onPreview?: ((profile: SketchProfileSelector | null) => void) | undefined
  dependencyDescription: string
}) {
  const t = useTranslations("app.shell.modelTree")
  return (
    <div className="ml-8 flex min-w-0 flex-wrap items-center gap-0.5 border-l border-border pl-1">
      <Link2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      {profiles.map((profile, index) => {
        if (!labelsByRef.has(`sketch:${profile.sketchId}`)) {
          return (
            <span
              key={canonicalJson(profile)}
              className="inline-flex min-w-0 items-center gap-1 px-2 text-xs text-destructive"
              title={t("sourceProfileUnavailable")}
            >
              <PenLine aria-hidden="true" className="size-3 shrink-0" />
              <span>{t("missingSourceSketch")}</span>
              <span className="sr-only">{t("sourceProfileUnavailable")}</span>
            </span>
          )
        }
        const sketch = labelsByRef.get(`sketch:${profile.sketchId}`) || t("unnamedSketch")
        const description = t("sourceProfile", { sketch, number: index + 1 })
        return (
          <Tooltip key={canonicalJson(profile)}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="min-w-0 max-w-full justify-start font-normal text-muted-foreground"
                aria-label={description}
                onPointerEnter={() => onPreview?.(profile)}
                onPointerLeave={(event) => {
                  if (event.currentTarget !== document.activeElement) onPreview?.(null)
                }}
                onFocus={() => onPreview?.(profile)}
                onBlur={() => onPreview?.(null)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  event.stopPropagation()
                  onPreview?.(null)
                  event.currentTarget
                    .closest("[data-history-id]")
                    ?.querySelector<HTMLElement>('[role="treeitem"]')
                    ?.focus()
                }}
                onClick={(event) => {
                  onPreview?.(null)
                  const source = event.currentTarget
                    .closest('[role="tree"]')
                    ?.querySelector<HTMLElement>(
                      `[data-history-id="${profile.sketchId}"] [role="treeitem"]`,
                    )
                  source?.scrollIntoView({ block: "nearest" })
                  source?.focus()
                }}
              >
                <PenLine aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{sketch}</span>
                {profiles.length > 1 && <span aria-hidden="true">{index + 1}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{description}</p>
              <p>{dependencyDescription}</p>
              <p>{t(onPreview ? "sourceProfileHint" : "sourceProfileLocateHint")}</p>
            </TooltipContent>
          </Tooltip>
        )
      })}
      <span className="sr-only">{dependencyDescription}</span>
    </div>
  )
}
