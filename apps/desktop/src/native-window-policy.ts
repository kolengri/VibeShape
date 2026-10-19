import type { OpenDialogReturnValue, WebContents } from "electron"

export function canSendNativeEvent(
  contents: Pick<WebContents, "isDestroyed" | "getURL"> | undefined,
  quitting: boolean,
  ownsNavigation: (url: string) => boolean,
) {
  if (quitting || !contents) return false
  return !contents.isDestroyed() && ownsNavigation(contents.getURL())
}

export function chosenNativeFile(result: OpenDialogReturnValue) {
  if (result.canceled) return null
  return result.filePaths[0] ?? null
}
