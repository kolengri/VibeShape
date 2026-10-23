import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import { useState } from "react"
import { assemblyMotionFailureKey } from "./assembly-motion-runner"
import { useAssemblyMotion } from "./use-assembly-motion"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

export function useAssemblyToolbarPlayback(view: AssemblyWorkspaceView, revision: number) {
  const [selection, setSelection] = useState<{ documentKey: string; id: string } | null>(null)
  const study =
    selection?.documentKey === view.documentKey
      ? (view.assembly.motionStudies?.find(({ id }) => id === selection.id) ?? null)
      : null
  const disabled = view.taskActionsDisabled
  const motion = useAssemblyMotion({
    key: `${view.documentKey}:toolbar:${study?.id ?? "idle"}`,
    joint: null,
    coordinate: null,
    study,
    joints: view.assembly.joints,
    revision,
    disabled: disabled || !study,
    onApply: view.mutations.apply,
  })
  return {
    study,
    motion,
    disabled,
    autoFit: !view.motionActive && !study,
    select: (id: string) => {
      motion.reset()
      setSelection({ documentKey: view.documentKey, id })
    },
  }
}
export type AssemblyToolbarPlayback = ReturnType<typeof useAssemblyToolbarPlayback>

export function AssemblyPlaybackToolbar({
  view,
  playback,
}: {
  view: AssemblyWorkspaceView
  playback: AssemblyToolbarPlayback
}) {
  const t = useTranslations("app.assembly")
  const { study, motion, disabled } = playback
  const failure = assemblyMotionFailureKey(motion.error)
  return (
    <>
      <ToolbarSeparator />
      <NativeSelect
        aria-label={t("motionPlaybackCase")}
        className="h-8 w-48 shrink-0"
        value={study?.id ?? ""}
        disabled={disabled || !view.assembly.motionStudies?.length}
        onChange={(event) => playback.select(event.currentTarget.value)}
      >
        <option value="">{t("motionSelectCase")}</option>
        {view.assembly.motionStudies?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </NativeSelect>
      <ToolbarButton asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !study || (motion.pending && !motion.playing)}
          onClick={() => {
            if (motion.playing) motion.pause()
            else if (study) void motion.play(0, study.duration)
          }}
        >
          {t(motion.playing ? "motionPause" : "motionPlay")}
        </Button>
      </ToolbarButton>
      <ToolbarButton asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !study}
          onClick={motion.reset}
        >
          {t("motionReset")}
        </Button>
      </ToolbarButton>
      <span role="status" aria-live="polite" className="shrink-0 text-xs text-muted-foreground">
        {failure ? t(failure) : motion.pending ? t("motionSolving") : null}
      </span>
    </>
  )
}
