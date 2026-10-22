import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { LightweightingPickTarget } from "./lightweighting-fields"
import type { useGenerativeDesignTask } from "./use-generative-design-task"

type StudyState = ReturnType<typeof useGenerativeDesignTask>

function setupAction(state: StudyState) {
  if (!state.source) return { kind: "source" as const }
  const fields = state.fields
  if (
    [fields.youngModulusMpa, fields.poissonRatio, fields.yieldStrengthMpa, fields.densityKgM3].some(
      (value) => value.trim() === "",
    )
  )
    return { kind: "material" as const }
  if (!fields.surfaceSelection?.supportFaces.length) return { kind: "fixed" as const }
  for (const [index, load] of fields.loadCases.entries()) {
    if (!fields.surfaceSelection.loadFaces[load.id]?.length)
      return { kind: "loaded" as const, index: index + 1, caseId: load.id }
    if (!load.surfaceForce || !(Number(load.surfaceForce.magnitudeN) > 0))
      return { kind: "force" as const, index: index + 1, caseId: load.id }
  }
  return { kind: "settings" as const }
}

function focusTarget(panel: HTMLElement, target: HTMLElement | null) {
  const scroller = panel.querySelector<HTMLElement>("[data-slot='task-panel-content']")
  if (!target || !scroller) return
  const fieldBounds = target.getBoundingClientRect()
  const scrollBounds = scroller.getBoundingClientRect()
  if (fieldBounds.top < scrollBounds.top) scroller.scrollTop += fieldBounds.top - scrollBounds.top
  else if (fieldBounds.bottom > scrollBounds.bottom)
    scroller.scrollTop += fieldBounds.bottom - scrollBounds.bottom
  target.focus({ preventScroll: true })
}

function focusField(panel: HTMLElement, id: string) {
  focusTarget(panel, panel.querySelector<HTMLElement>(`#${id}`))
}

function revealSettings(panel: HTMLElement) {
  for (const details of panel.querySelectorAll("details")) details.open = true
  focusTarget(
    panel,
    panel.querySelector<HTMLElement>("input:invalid") ??
      panel.querySelector<HTMLElement>("summary"),
  )
}

function performSetupAction(
  action: ReturnType<typeof setupAction>,
  panel: HTMLElement | null,
  onPick: (target: LightweightingPickTarget) => void,
) {
  if (!panel) return
  switch (action.kind) {
    case "source":
      focusField(panel, "lightweighting-part")
      break
    case "material":
      focusField(panel, "lightweighting-material")
      break
    case "force":
      focusField(panel, `lightweighting-force-${action.caseId}`)
      break
    case "fixed":
      onPick({ kind: "support" })
      focusField(panel, "lightweighting-support-pick")
      break
    case "loaded":
      onPick({ kind: "load", caseId: action.caseId })
      focusField(panel, `lightweighting-load-pick-${action.caseId}`)
      break
    case "settings":
      revealSettings(panel)
      break
  }
}

export function GenerativeSetupAction({
  state,
  disabled,
  onPick,
}: {
  state: StudyState
  disabled: boolean
  onPick: (target: LightweightingPickTarget) => void
}) {
  const t = useTranslations("app.generativeDesign")
  if (disabled || state.activity !== "idle" || state.canAnalyze) return null
  const action = setupAction(state)
  const label = {
    source: t("chooseSource"),
    material: t("chooseMaterial"),
    fixed: t("pickFixed"),
    loaded: t("pickLoaded", { index: "index" in action ? action.index : 1 }),
    force: t("enterForce", { index: "index" in action ? action.index : 1 }),
    settings: t("checkSettings"),
  }[action.kind]
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="max-w-full"
      onClick={(event) =>
        performSetupAction(action, event.currentTarget.closest("section"), onPick)
      }
    >
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}
