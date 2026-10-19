import { mkdirSync } from "node:fs"
import { reportDesktopStartupFailure } from "./editor-load-error"

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
    mkdirSync(path, { recursive: true })
    options.setUserDataPath(path)
    return true
  } catch (error) {
    reportDesktopStartupFailure(error, options.packaged, options.showErrorBox)
    return false
  }
}
