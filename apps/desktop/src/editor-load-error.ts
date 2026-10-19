import { desktopMessage as t } from "./messages"

export function reportEditorLoadFailure(
  error: unknown,
  packaged: boolean,
  showErrorBox: (title: string, content: string) => void,
) {
  if (!packaged) console.error("The desktop editor failed to load:", error)
  showErrorBox(t("editorErrorTitle"), t("editorLoadFailed"))
}
