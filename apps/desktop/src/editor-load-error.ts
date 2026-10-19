import { desktopMessage as t } from "./messages"

export function reportEditorLoadFailure(
  error: unknown,
  packaged: boolean,
  showErrorBox: (title: string, content: string) => void,
) {
  if (!packaged) console.error("The desktop editor failed to load:", error)
  showErrorBox(t("editorErrorTitle"), t("editorLoadFailed"))
}

export function reportDesktopStartupFailure(
  error: unknown,
  packaged: boolean,
  showErrorBox: (title: string, content: string) => void,
) {
  if (!packaged) console.error("The desktop host failed to start:", error)
  showErrorBox(t("startupErrorTitle"), t("startupFailed"))
}
