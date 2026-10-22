import { join, resolve } from "node:path"
import { ASSISTANT_EVENT_CHANNEL } from "@vibeshape/automation-api/assistant"
import {
  DESKTOP_COMMAND_CHANNEL,
  DESKTOP_COMMAND_STATE_CHANNEL,
  DESKTOP_FULL_SCREEN_CHANGED_CHANNEL,
  DESKTOP_FULL_SCREEN_CHANNEL,
  DESKTOP_MCP_DESCRIPTOR_NAME,
  DESKTOP_MCP_SETUP_CHANNEL,
  DESKTOP_TEXT_EDIT_CHANNEL,
  type DesktopCommand,
  desktopApplicationCommandSchema,
  desktopCommandStateSchema,
  desktopEditorCommandSchema,
  desktopMcpSetupSchema,
  desktopTextEditSchema,
} from "@vibeshape/automation-api/desktop-host"
import { localDocumentSchema } from "@vibeshape/automation-api/local-session"
import {
  app,
  BrowserWindow,
  type DownloadItem,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  session,
  shell,
  type WebContents,
  type WebFrameMain,
} from "electron"
import { registerAssistantIpc } from "./assistant-ipc"
import { createAssistantLaunchResolver } from "./assistant-jev-runtime"
import { createAssistantService } from "./assistant-service"
import { reportDesktopStartupFailure, reportEditorLoadFailure } from "./editor-load-error"
import { DESKTOP_EDITOR_ORIGIN, startEditorServer } from "./editor-server"
import { createDesktopMcpService } from "./mcp-service"
import { desktopMessage as t } from "./messages"
import { createNativeSlicerService } from "./native-slicer"
import { registerNativeSlicerIpc } from "./native-slicer-ipc"
import { canSendNativeEvent, chosenNativeFile } from "./native-window-policy"
import { preparePrivateDirectory } from "./private-files"
import { initializeDesktopProfile } from "./startup-profile"
import { createPendingUpdateWork } from "./update-work"
import {
  type DesktopRelease,
  DesktopUpdateError,
  downloadDesktopUpdate,
  findDesktopUpdate,
} from "./updates"

app.setName("VibeShape")
const updateFormat =
  process.platform === "win32"
    ? ({
        ready: "windowsUpdateReadyDetail",
        available: "windowsUpdateAvailableDetail",
        reveal: "showInFolder",
        type: "zipArchiveType",
        extension: "zip",
      } as const)
    : ({
        ready: "updateReadyDetail",
        available: "updateAvailableDetail",
        reveal: "showInFinder",
        type: "diskImageType",
        extension: "dmg",
      } as const)
const commandLineProfile = app.commandLine.getSwitchValue("user-data-dir")
const profileContainer =
  commandLineProfile || (!app.isPackaged && process.env.VIBESHAPE_DESKTOP_USER_DATA)
    ? resolve(commandLineProfile || process.env.VIBESHAPE_DESKTOP_USER_DATA || "")
    : join(app.getPath("appData"), "VibeShape")
// Electron can create the CLI container before JavaScript, with an elevated token's default owner.
// Keep the actual Windows browser profile separate so our private-file policy creates it first.
const profile =
  process.platform === "win32" ? join(profileContainer, "User Data") : profileContainer
app.enableSandbox()

const testPort = !app.isPackaged ? process.env.VIBESHAPE_DESKTOP_TEST_PORT : undefined
if (
  testPort !== undefined &&
  (!/^\d{4,5}$/.test(testPort) || Number(testPort) < 1024 || Number(testPort) > 65535)
)
  throw new Error("The desktop test port must be between 1024 and 65535.")
const editorOrigin = testPort ? `http://127.0.0.1:${testPort}` : DESKTOP_EDITOR_ORIGIN
const descriptorPath = join(profile, DESKTOP_MCP_DESCRIPTOR_NAME)
const runtimeDirectory = app.isPackaged ? app.getAppPath() : join(app.getAppPath(), "dist")
const resolveAssistantLaunch = createAssistantLaunchResolver({
  executable: process.execPath,
  runtimeDirectory,
})
let editor: Awaited<ReturnType<typeof startEditorServer>> | undefined
let nativeMcp: ReturnType<typeof createDesktopMcpService> | undefined
let nativeSlicer: ReturnType<typeof createNativeSlicerService> | undefined
let assistant: ReturnType<typeof createAssistantService> | undefined
let assistantClosing = Promise.resolve()
let unregisterAssistant: (() => void) | undefined
let unregisterSlicer: (() => void) | undefined
const nativeDirectory = join(profile, "native-workflows")
const assistantDirectory = join(nativeDirectory, "assistant")
let mainWindow: BrowserWindow | undefined
let licensesWindow: BrowserWindow | undefined
let quitting = false
let shutdownComplete = false
let updateBusy = false
let updateController: AbortController | undefined
const updateWork = createPendingUpdateWork()
let startup: Promise<void> = Promise.resolve()
const ownedContents = new Set<WebContents>()
const enabledNativeCommands = new Set<DesktopCommand>()

function ownsUrl(value: string) {
  try {
    return new URL(value).origin === editorOrigin
  } catch {
    return false
  }
}

function ownsEditorNavigation(value: string | undefined) {
  if (value === undefined) return false
  return ownsUrl(value) && value.startsWith(`${editorOrigin}/`)
}

function createWindow(url: string) {
  const editorWindow = new URL(url).pathname === "/"
  const unified = process.platform === "darwin" && editorWindow
  const window = new BrowserWindow({
    title: "VibeShape",
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#17191c",
    show: false,
    ...(unified
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 20 } }
      : {}),
    webPreferences: {
      // The editor owns native MCP heartbeats even while minimized or occluded.
      backgroundThrottling: !editorWindow,
      preload: join(runtimeDirectory, "preload.cjs"),
      additionalArguments: unified ? ["--vibeshape-unified-chrome"] : [],
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
  const publishFullScreen = () => {
    if (!window.isDestroyed() && canSendNativeEvent(contents, quitting, ownsEditorNavigation))
      contents.send(DESKTOP_FULL_SCREEN_CHANGED_CHANNEL, window.isFullScreen())
  }
  window.on("enter-full-screen", publishFullScreen)
  window.on("leave-full-screen", publishFullScreen)
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
    installAssistant()
    mainWindow = createWindow(`${editorOrigin}/`)
    mainWindow.on("closed", () => {
      mainWindow = undefined
      closeAssistant()
      enabledNativeCommands.clear()
      refreshNativeCommandMenu()
    })
  }
  focusWindow(mainWindow)
}

function showLicenses() {
  if (quitting || !editor) return
  if (!licensesWindow) {
    licensesWindow = createWindow(`${editorOrigin}/sources/index.html`)
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
    detail: t(updateFormat.ready),
    buttons: [t(updateFormat.reveal), t("done")],
    defaultId: 0,
    cancelId: 1,
  })
  if (finished.response === 0 && !quitting) shell.showItemInFolder(path)
}

async function chooseUpdateDestination(release: DesktopRelease) {
  if (quitting) return undefined
  const destination = await dialog.showSaveDialog({
    title: t("downloadTitle", { version: release.version }),
    defaultPath: join(app.getPath("downloads"), release.fileName),
    filters: [{ name: t(updateFormat.type), extensions: [updateFormat.extension] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  })
  if (destination.canceled || quitting) return undefined
  return destination.filePath
}

async function downloadToDestination(release: DesktopRelease, path: string, signal: AbortSignal) {
  const progressWindow = mainWindow
  try {
    setDownloadProgress(progressWindow, 0)
    await updateWork.run(() =>
      downloadDesktopUpdate(release, path, {
        signal,
        onProgress: (fraction) => setDownloadProgress(progressWindow, fraction),
      }),
    )
    await showDownloadedUpdate(path)
  } finally {
    setDownloadProgress(progressWindow, -1)
  }
}

async function retryUpdateDestination(error: unknown) {
  if (quitting) return false
  if (!(error instanceof DesktopUpdateError) || error.failure.kind !== "destination-exists")
    throw error
  const retry = await dialog.showMessageBox({
    type: "error",
    message: t("updateErrorTitle"),
    detail: t("updateErrorDestinationExists"),
    buttons: [t("chooseAnotherName"), t("cancel")],
    defaultId: 0,
    cancelId: 1,
  })
  return retry.response === 0
}

async function downloadRelease(release: DesktopRelease, signal: AbortSignal) {
  let retry = true
  while (retry) {
    const path = await chooseUpdateDestination(release)
    if (!path) return
    try {
      await downloadToDestination(release, path, signal)
      return
    } catch (error) {
      retry = await retryUpdateDestination(error)
    }
  }
}

async function offerUpdate(release: DesktopRelease, signal: AbortSignal) {
  try {
    const choice = await dialog.showMessageBox({
      type: "info",
      message: t("updateAvailableTitle", { version: release.version }),
      detail: t(updateFormat.available, { megabytes: Math.ceil(release.size / 1024 / 1024) }),
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
    throw new Error("The desktop architecture is unsupported for updates.")
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
    "destination-exists": "updateErrorDestinationExists",
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

function refreshNativeCommandMenu() {
  const menu = Menu.getApplicationMenu()
  for (const id of [
    ...desktopEditorCommandSchema.options,
    ...desktopApplicationCommandSchema.options,
  ]) {
    const item = menu?.getMenuItemById(`native-${id}`)
    if (item) item.enabled = enabledNativeCommands.has(id)
  }
}

function nativeCommandItem(
  id: DesktopCommand,
  label: string,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    id: `native-${id}`,
    label,
    enabled: false,
    ...(accelerator ? { accelerator } : {}),
    click() {
      if (
        enabledNativeCommands.has(id) &&
        mainWindow &&
        ownsEditorNavigation(mainWindow.webContents.getURL())
      )
        mainWindow.webContents.send(DESKTOP_COMMAND_CHANNEL, { id })
    },
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
      nativeCommandItem("settings", t("preferences"), "CmdOrCtrl+,"),
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
      {
        label: t("fileMenu"),
        submenu: [
          nativeCommandItem("projects", t("projects"), "CmdOrCtrl+O"),
          nativeCommandItem("export", t("export"), "CmdOrCtrl+Shift+E"),
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: t("editMenu"),
        submenu: [
          nativeCommandItem("undo", t("undo"), "CmdOrCtrl+Z"),
          nativeCommandItem("redo", t("redo"), "CmdOrCtrl+Shift+Z"),
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
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
      {
        label: t("modelMenu"),
        submenu: [
          nativeCommandItem("createSketch", t("createSketch")),
          nativeCommandItem("createBox", t("createBox")),
          nativeCommandItem("createCylinder", t("createCylinder")),
          { type: "separator" },
          nativeCommandItem("createExtrusion", t("createExtrusion")),
          nativeCommandItem("createRevolve", t("createRevolve")),
          nativeCommandItem("createFillet", t("createFillet")),
          nativeCommandItem("createChamfer", t("createChamfer")),
          nativeCommandItem("measure", t("measure")),
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          nativeCommandItem("faq", t("faq")),
          nativeCommandItem("shortcuts", t("shortcuts")),
          { type: "separator" },
          { label: t("licensesAndSourceCode"), click: showLicenses },
        ],
      },
    ]),
  )
}

function isOwnedMainFrame(contents: WebContents, frame: WebFrameMain | null) {
  return frame === contents.mainFrame && ownedContents.has(contents)
}

function ownsDownload(item: DownloadItem) {
  return item.getInitiatorOrigin() === editorOrigin && ownsUrl(item.getURL())
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
      origin === editorOrigin &&
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

function isEditorSender(event: IpcMainInvokeEvent) {
  if (event.sender !== mainWindow?.webContents) return false
  return (
    isOwnedMainFrame(event.sender, event.senderFrame) &&
    ownsEditorNavigation(event.sender.mainFrame.url)
  )
}
function requireEditorSender(event: IpcMainInvokeEvent) {
  if (!isEditorSender(event))
    throw new Error("Native controls require the owned editor main frame.")
}
function mcpSetup(selectedDescriptor = descriptorPath) {
  return desktopMcpSetupSchema.parse({
    protocolVersion: 1,
    mcpServers: {
      vibeshape: {
        command: process.execPath,
        args: [join(runtimeDirectory, "mcp.cjs"), "--descriptor", selectedDescriptor],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
  })
}
function closeAssistant() {
  unregisterAssistant?.()
  unregisterAssistant = undefined
  const closing = assistant?.close() ?? Promise.resolve()
  assistant = undefined
  assistantClosing = Promise.allSettled([assistantClosing, closing]).then(() => undefined)
  return assistantClosing
}
function installAssistant() {
  if (assistant) return
  assistant = createAssistantService({
    cwd: assistantDirectory,
    preferencesPath: join(assistantDirectory, "session-preferences.json"),
    resolveLaunch: resolveAssistantLaunch,
    applicationVersion: app.getVersion(),
    async getMcpSetup(projectId, questions) {
      const id = localDocumentSchema.shape.id.parse(projectId)
      if (!nativeMcp) throw new Error("Native MCP is unavailable.")
      const path = await nativeMcp.publishProject(
        id,
        join(assistantDirectory, `${id}.mcp.json`),
        questions,
      )
      return mcpSetup(path)
    },
    releaseMcpSetup: (projectId, questions) => nativeMcp?.releaseProject(projectId, questions),
    async isMcpClientAttached(projectId?: string) {
      await assistantClosing
      return nativeMcp?.isClientAttached(projectId) ?? false
    },
    whenMcpClientReleased: (projectId?: string) =>
      nativeMcp?.whenClientReleased(projectId) ?? Promise.resolve(),
    onEvent(event) {
      const contents = mainWindow?.webContents
      if (contents && canSendNativeEvent(contents, quitting, ownsEditorNavigation))
        contents.send(ASSISTANT_EVENT_CHANNEL, event)
    },
  })
  unregisterAssistant = registerAssistantIpc({
    ipcMain,
    isOwnedSender: isEditorSender,
    service: assistant,
  })
}
function installNativeSlicer() {
  nativeSlicer = createNativeSlicerService({
    directory: nativeDirectory,
    async chooseApplication() {
      const window = mainWindow
      if (!window || window.isDestroyed()) return null
      const result = await dialog.showOpenDialog(window, {
        title: t("chooseSlicer"),
        properties: ["openFile"],
      })
      return chosenNativeFile(result)
    },
    reveal: (path) => shell.showItemInFolder(path),
  })
  unregisterSlicer = registerNativeSlicerIpc({
    ipcMain,
    isOwnedSender: isEditorSender,
    service: nativeSlicer,
  })
}

function installNativeBridge() {
  ipcMain.handle(DESKTOP_FULL_SCREEN_CHANNEL, (event) => {
    requireEditorSender(event)
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  })
  ipcMain.handle(DESKTOP_MCP_SETUP_CHANNEL, (event) => {
    requireEditorSender(event)
    return mcpSetup()
  })
  ipcMain.handle(DESKTOP_COMMAND_STATE_CHANNEL, (event, payload: unknown) => {
    requireEditorSender(event)
    const state = desktopCommandStateSchema.parse(payload)
    const commands =
      state.scope === "editor"
        ? desktopEditorCommandSchema.options
        : desktopApplicationCommandSchema.options
    for (const id of commands) enabledNativeCommands.delete(id)
    for (const id of state.enabled) enabledNativeCommands.add(id)
    refreshNativeCommandMenu()
  })
  ipcMain.handle(DESKTOP_TEXT_EDIT_CHANNEL, (event, payload: unknown) => {
    requireEditorSender(event)
    const action = desktopTextEditSchema.parse(payload)
    if (action === "undo") event.sender.undo()
    else event.sender.redo()
  })
}

const profileReady = initializeDesktopProfile(profile, {
  packaged: app.isPackaged,
  setUserDataPath: (path) => app.setPath("userData", path),
  showErrorBox: dialog.showErrorBox,
})
if (!profileReady) app.quit()
else if (!app.requestSingleInstanceLock()) app.quit()
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
        await closeAssistant()
        unregisterSlicer?.()
        nativeSlicer?.close()
        await editor?.close()
        await nativeMcp?.close()
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
      nativeMcp = createDesktopMcpService(editorOrigin)
      editor = await startEditorServer(directory, { origin: editorOrigin, mcp: nativeMcp })
      await nativeMcp.publish(descriptorPath)
      if (quitting) return
      preparePrivateDirectory(nativeDirectory)
      preparePrivateDirectory(assistantDirectory)
      restrictSession()
      installNativeSlicer()
      installNativeBridge()
      installMenu()
      focusEditor()
      mainWindow?.webContents.once("did-finish-load", () => {
        if (app.isPackaged) void checkForUpdates(true)
      })
    })
    .catch((error: unknown) => {
      if (!quitting) {
        reportDesktopStartupFailure(error, app.isPackaged, dialog.showErrorBox)
        app.quit()
      }
    })
}
