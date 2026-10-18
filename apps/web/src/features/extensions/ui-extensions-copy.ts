import type { UiPluginError } from "./ui-plugin-package"

export type UiExtensionsCopy = Readonly<{
  title: string
  description: string
  close: string
  loading: string
  empty: string
  installFile: string
  fileLabel: string
  reviewTitle: string
  reviewDescription: string
  permissions: string
  capabilityCommand: string
  capabilityPanel: string
  installAndEnable: string
  cancel: string
  enabled: string
  disabled: string
  enable: string
  disable: string
  remove: string
  openPanel: string
  panelLoading: string
  panelFailed: string
  closePanel: string
  reloadPanel: string
  compute: string
  invalidInputs: string
  results: string
  sampleDownload: string
  resetStore: string
  resetStoreDescription: string
  version: (version: string) => string
  errors: Readonly<Record<UiPluginError, string>>
}>

export type UiPanelCopy = Pick<UiExtensionsCopy, "compute" | "invalidInputs" | "results">
