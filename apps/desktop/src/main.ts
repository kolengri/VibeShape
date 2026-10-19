import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  app,
  BrowserWindow,
  type DownloadItem,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  session,
  shell,
  type WebContents,
  type WebFrameMain,
} from "electron"
import { reportDesktopStartupFailure, reportEditorLoadFailure } from "./editor-load-error"
import { DESKTOP_EDITOR_ORIGIN, startEditorServer } from "./editor-server"
import { desktopMessage as t } from "./messages"
import { createPendingUpdateWork } from "./update-work"
import {
  type DesktopRelease,
  DesktopUpdateError,
  downloadDesktopUpdate,
  findDesktopUpdate,
} from "./updates"

app.setName("VibeShape")
const commandLineProfile = app.commandLine.getSwitchValue("user-data-dir")
const profile =
  commandLineProfile || (!app.isPackaged && process.env.VIBESHAPE_DESKTOP_USER_DATA)
    ? resolve(commandLineProfile || process.env.VIBESHAPE_DESKTOP_USER_DATA || "")
    : join(app.getPath("appData"), "VibeShape")
mkdirSync(profile, { recursive: true })
app.setPath("userData", profile)
app.enableSandbox()

let editor: Awaited<ReturnType<typeof startEditorServer>> | undefined
let mainWindow: BrowserWindow | undefined
let licensesWindow: BrowserWindow | undefined
let quitting = false
let shutdownComplete = false
let updateBusy = false
let updateController: AbortController | undefined
const updateWork = createPendingUpdateWork()
let startup: Promise<void> = Promise.resolve()
const ownedContents = new Set<WebContents>()

function ownsUrl(value: string) {
  try {
    return new URL(value).origin === DESKTOP_EDITOR_ORIGIN
  } catch {
    return false
  }
}

function ownsEditorNavigation(value: string | undefined) {
  if (value === undefined) return false
  return ownsUrl(value) && value.startsWith(`${DESKTOP_EDITOR_ORIGIN}/`)
}

function createWindow(url: string) {
  const window = new BrowserWindow({
    title: "VibeShape",
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#17191c",
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
    },
  })
  const contents = window.webContents
  ownedContents.add(contents)
  window.once("closed", () => ownedContents.delete(contents))
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-attach-webview", (event) => event.preventDefault())
  window.webContents.on("will-frame-navigate", (event) => {
    const permitted = event.isMainFrame
      ? ownsEditorNavigation(event.url)
      : event.url === "about:srcdoc" || event.url === "about:blank"
    if (!permitted) event.preventDefault()
  })
  window.webContents.on("will-redirect", (event, destination) => {
    if (!ownsUrl(destination)) event.preventDefault()
  })
  window.once("ready-to-show", () => window.show())
  void window.loadURL(url).catch((error: unknown) => {
    if (!quitting && !window.isDestroyed()) {
      reportEditorLoadFailure(error, app.isPackaged, dialog.showErrorBox)
      app.quit()
    }
  })
  return window
}

function focusWindow(window: BrowserWindow) {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function focusEditor() {
  if (quitting || !editor) return
  if (!mainWindow) {
    mainWindow = createWindow(`${DESKTOP_EDITOR_ORIGIN}/`)
    mainWindow.on("closed", () => {
      mainWindow = undefined
    })
  }
  focusWindow(mainWindow)
}

function showLicenses() {
  if (quitting || !editor) return
  if (!licensesWindow) {
    licensesWindow = createWindow(`${DESKTOP_EDITOR_ORIGIN}/sources/index.html`)
    licensesWindow.on("closed", () => {
      licensesWindow = undefined
    })
  }
  focusWindow(licensesWindow)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : t("unexpectedError")
}

function setUpdateBusy(busy: boolean) {
  updateBusy = busy
  const item = Menu.getApplicationMenu()?.getMenuItemById("check-for-updates")
  if (item) item.enabled = !busy
}

function setDownloadProgress(window: BrowserWindow | undefined, fraction: number) {
  if (window && !window.isDestroyed()) window.setProgressBar(fraction)
}

async function showDownloadedUpdate(path: string) {
  if (quitting) return
  const finished = await dialog.showMessageBox({
    type: "info",
    message: t("updateReadyTitle"),
    detail: t("updateReadyDetail"),
    buttons: [t("showInFinder"), t("done")],
    defaultId: 0,
    cancelId: 1,
  })
  if (finished.response === 0 && !quitting) shell.showItemInFolder(path)
}

async function downloadRelease(release: DesktopRelease, signal: AbortSignal) {
  const destination = await dialog.showSaveDialog({
    title: t("downloadTitle", { version: release.version }),
    defaultPath: join(app.getPath("downloads"), release.fileName),
    filters: [{ name: t("diskImageType"), extensions: ["dmg"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  })
  if (destination.canceled || !destination.filePath || quitting) return
  const progressWindow = mainWindow
  try {
    setDownloadProgress(progressWindow, 0)
    await updateWork.run(() =>
      downloadDesktopUpdate(release, destination.filePath, {
        signal,
        onProgress: (fraction) => setDownloadProgress(progressWindow, fraction),
      }),
    )
    await showDownloadedUpdate(destination.filePath)
  } finally {
    setDownloadProgress(progressWindow, -1)
  }
}

async function offerUpdate(release: DesktopRelease, signal: AbortSignal) {
  try {
    const choice = await dialog.showMessageBox({
      type: "info",
      message: t("updateAvailableTitle", { version: release.version }),
      detail: t("updateAvailableDetail", { megabytes: Math.ceil(release.size / 1024 / 1024) }),
      buttons: [t("download"), t("later")],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response === 0 && !quitting) await downloadRelease(release, signal)
  } catch (error) {
    await reportUpdateFailure(error)
  }
}

async function findUpdate(signal: AbortSignal) {
  const architecture = process.arch
  if (architecture !== "arm64" && architecture !== "x64")
    throw new Error("Updates are available for Apple Silicon and Intel Macs only.")
  return updateWork.run(() => findDesktopUpdate(app.getVersion(), architecture, signal))
}

async function reportUpdateFailure(error: unknown) {
  if (quitting) return
  await dialog.showMessageBox({
    type: "error",
    message: t("updateErrorTitle"),
    detail: updateFailureDetail(error),
  })
}

function updateFailureDetail(error: unknown) {
  if (!(error instanceof DesktopUpdateError)) return t("updateErrorUnknown")
  if (error.failure.kind === "http") return t("updateErrorHttp", { status: error.failure.status })
  const keys = {
    network: "updateErrorNetwork",
    "invalid-response": "updateErrorResponse",
    integrity: "updateErrorIntegrity",
    destination: "updateErrorDestination",
  } as const
  return t(keys[error.failure.kind])
}

async function lookupRelease(quiet: boolean, signal: AbortSignal) {
  try {
    return await findUpdate(signal)
  } catch (error) {
    if (!quiet) await reportUpdateFailure(error)
    return undefined
  }
}

async function reportCurrentVersion(quiet: boolean) {
  if (quiet) return
  await dialog.showMessageBox({
    type: "info",
    message: t("upToDateTitle"),
    detail: t("upToDateDetail", { version: app.getVersion() }),
  })
}

async function presentRelease(
  release: DesktopRelease | null | undefined,
  quiet: boolean,
  signal: AbortSignal,
) {
  if (quitting || release === undefined) return
  if (release) await offerUpdate(release, signal)
  else await reportCurrentVersion(quiet)
}

async function checkForUpdates(quiet: boolean) {
  if (updateBusy || quitting) return
  setUpdateBusy(true)
  const controller = new AbortController()
  updateController = controller
  try {
    await presentRelease(await lookupRelease(quiet, controller.signal), quiet, controller.signal)
  } finally {
    updateController = undefined
    setUpdateBusy(false)
  }
}

function installMenu() {
  app.setAboutPanelOptions({
    applicationName: "VibeShape",
    applicationVersion: app.getVersion(),
    copyright: "GPL-3.0-or-later",
  })
  const application: MenuItemConstructorOptions = {
    label: "VibeShape",
    submenu: [
      { role: "about" },
      {
        id: "check-for-updates",
        label: t("checkForUpdates"),
        click: () => void checkForUpdates(false),
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      application,
      { role: "editMenu" },
      {
        label: t("viewMenu"),
        submenu: [
          { role: "reload" },
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      { role: "help", submenu: [{ label: t("licensesAndSourceCode"), click: showLicenses }] },
    ]),
  )
}

function isOwnedMainFrame(contents: WebContents, frame: WebFrameMain | null) {
  return frame === contents.mainFrame && ownedContents.has(contents)
}

function ownsDownload(item: DownloadItem) {
  return item.getInitiatorOrigin() === DESKTOP_EDITOR_ORIGIN && ownsUrl(item.getURL())
}

function trustedClipboardFrame(
  contents: WebContents | null,
  details: { isMainFrame: boolean; requestingUrl?: string },
) {
  if (!mainWindow || contents !== mainWindow.webContents || !details.isMainFrame) return false
  return ownsEditorNavigation(details.requestingUrl)
}

function restrictSession() {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      permission === "clipboard-sanitized-write" && trustedClipboardFrame(contents, details),
    ),
  )
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      permission === "clipboard-sanitized-write" &&
      origin === DESKTOP_EDITOR_ORIGIN &&
      trustedClipboardFrame(contents, details),
  )
  session.defaultSession.setDevicePermissionHandler(() => false)
  session.defaultSession.on("will-download", (event, item, contents, frame) => {
    if (!isOwnedMainFrame(contents, frame) || !ownsDownload(item)) event.preventDefault()
    // Async model exports can outlive transient activation; the owned main frame is authoritative.
    else
      item.setSaveDialogOptions({
        title: t("saveTitle"),
        properties: ["createDirectory", "showOverwriteConfirmation"],
      })
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on("second-instance", focusEditor)
  app.on("activate", focusEditor)
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
  app.on("before-quit", (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    updateController?.abort()
    const updatesSettled = updateWork.stop()
    void startup
      .catch(() => undefined)
      .then(async () => {
        await editor?.close()
        session.defaultSession.flushStorageData()
      })
      .catch((error: unknown) => console.error("VibeShape shutdown failed:", errorMessage(error)))
      .finally(async () => {
        await updatesSettled
        shutdownComplete = true
        app.quit()
      })
  })
  startup = app
    .whenReady()
    .then(async () => {
      const directory = app.isPackaged
        ? join(process.resourcesPath, "editor")
        : process.env.VIBESHAPE_DESKTOP_EDITOR
          ? resolve(process.env.VIBESHAPE_DESKTOP_EDITOR)
          : resolve(app.getAppPath(), "../web/dist")
      editor = await startEditorServer(directory)
      if (quitting) return
      restrictSession()
      installMenu()
      focusEditor()
      mainWindow?.webContents.once("did-finish-load", () => void checkForUpdates(true))
    })
    .catch((error: unknown) => {
      if (!quitting) {
        reportDesktopStartupFailure(error, app.isPackaged, dialog.showErrorBox)
        app.quit()
      }
    })
}
