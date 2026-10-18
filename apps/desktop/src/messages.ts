import { createTranslator } from "use-intl/core"

const messages = {
  desktop: {
    editorErrorTitle: "VibeShape could not open the editor",
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
    updateErrorDetail: "{error} Check your internet connection and try Check for Updates again.",
    checkForUpdates: "Check for Updates…",
    viewMenu: "View",
    licensesAndSourceCode: "Licenses and Source Code",
    saveTitle: "Save from VibeShape",
  },
} as const

export const desktopMessage = createTranslator({ locale: "en", namespace: "desktop", messages })
