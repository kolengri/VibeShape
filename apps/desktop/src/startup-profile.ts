import { mkdirSync } from "node:fs"
import { reportDesktopStartupFailure } from "./editor-load-error"
import { preparePrivateDirectory } from "./private-files"

/** Configure userData before Electron readiness, or report the failure before any host starts. */
export function initializeDesktopProfile(
  path: string,
  options: {
    packaged: boolean
    setUserDataPath: (path: string) => void
    showErrorBox: (title: string, content: string) => void
  },
) {
  try {
    if (process.platform === "win32") preparePrivateDirectory(path)
    else mkdirSync(path, { recursive: true })
    options.setUserDataPath(path)
    return true
  } catch (error) {
    reportDesktopStartupFailure(error, options.packaged, options.showErrorBox)
    return false
  }
}
