import { useTranslations } from "@vibeshape/i18n"
import { cn } from "@vibeshape/ui/lib/cn"
import { useMemo } from "react"
import { SAFE_VIEWPORT_LEFT } from "../../shell/viewport-chrome-styles"
import { assemblyMotionCoordinates } from "./assembly-motion"
import { AssemblyMotionPanel } from "./assembly-motion-panel"
import { useAssemblyMotion } from "./use-assembly-motion"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

/** Binds a disposable drive session to the currently reviewed document and authored mutation path. */
export function useAssemblyMotionSession(view: AssemblyWorkspaceView) {
  const joint = view.assembly.joints.find(({ id }) => id === view.motion?.id) ?? null
  const coordinate = useMemo(
    () =>
      joint
        ? (assemblyMotionCoordinates(joint).find(({ kind }) => kind === view.motion?.coordinate) ??
          null)
        : null,
    [joint, view.motion?.coordinate],
  )
  const state = useAssemblyMotion({
    key: `${view.documentKey}:${view.motion?.id ?? "idle"}:${coordinate?.kind ?? "none"}`,
    joint,
    coordinate,
    revision: view.motion?.revision ?? -1,
    disabled: view.disabled || !view.motion,
    onApply: async (changes, revision) => {
      const applied = await view.mutations.apply(changes, revision)
      if (applied) view.closeMotion(view.documentKey)
      return applied
    },
  })
  return { joint, coordinate, state }
}
export type AssemblyMotionSession = ReturnType<typeof useAssemblyMotionSession>

export function AssemblyMotionTask({
  view,
  motion,
}: {
  view: AssemblyWorkspaceView
  motion: AssemblyMotionSession
}) {
  if (!view.motion || !motion.joint || !motion.coordinate) return null
  return (
    <AssemblyMotionPanel
      key={`${view.motion.id}:${view.motion.coordinate}:${view.documentKey}`}
      joint={motion.joint}
      coordinate={motion.coordinate}
      motion={motion.state}
      disabled={view.disabled}
      error={view.mutations.error}
      onCoordinate={view.setMotionCoordinate}
      onClose={() => view.closeMotion()}
    />
  )
}
export function AssemblyMotionPreviewBadge({ visible }: { visible: boolean }) {
  const t = useTranslations("app.assembly")
  return visible ? (
    <p
      role="status"
      className={cn(
        "pointer-events-none absolute top-3 left-3 rounded-md border bg-panel p-2 text-xs",
        SAFE_VIEWPORT_LEFT,
      )}
    >
      {t("motionPreviewBadge")}
    </p>
  ) : null
}
