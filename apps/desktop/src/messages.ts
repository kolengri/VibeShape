import { createTranslator } from "use-intl/core"

const messages = {
  desktop: {
    editorLoadFailed:
      "The editor could not be loaded. Quit VibeShape and open it again. If the problem continues, reinstall the app.",
    editorErrorTitle: "VibeShape could not open the editor",
    startupFailed:
      "The local editor could not be started. Quit VibeShape and open it again. If the problem continues, reinstall the app.",
    startupErrorTitle: "VibeShape could not start",
    unexpectedError: "An unexpected error occurred. Please try again.",
    upToDateTitle: "VibeShape is up to date",
    upToDateDetail: "You are using version {version}.",
    updateAvailableTitle: "VibeShape {version} is available",
    updateAvailableDetail:
      "Download the macOS disk image ({megabytes, number} MB). Your local projects stay available.",
    download: "Download",
    later: "Later",
    downloadTitle: "Download VibeShape {version}",
    diskImageType: "macOS disk image",
    updateReadyTitle: "The update is ready",
    updateReadyDetail:
      "The disk image passed its SHA-256 integrity check. Open it in Finder and replace VibeShape in Applications when you are ready.",
    showInFinder: "Show in Finder",
    done: "Done",
    updateErrorTitle: "VibeShape could not complete the update",
    updateErrorUnknown: "The update could not be completed. Try Check for Updates again.",
    updateErrorNetwork:
      "The update service could not be reached. Check your internet connection and try again.",
    updateErrorHttp:
      "The update service returned HTTP {status, number, ::group-off}. Try Check for Updates again later.",
    updateErrorResponse:
      "The update service returned an invalid response. Try Check for Updates again later.",
    updateErrorIntegrity:
      "The downloaded update failed its integrity check and was not saved. Try downloading it again.",
    updateErrorDestination:
      "The update could not be saved. Choose a writable folder and a new file name, then try again.",
    checkForUpdates: "Check for Updates…",
    viewMenu: "View",
    licensesAndSourceCode: "Licenses and Source Code",
    saveTitle: "Save from VibeShape",
  },
} as const

export const desktopMessage = createTranslator({ locale: "en", namespace: "desktop", messages })
