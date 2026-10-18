import { useTranslations } from "@vibeshape/i18n"
import type { ComponentProps } from "react"
import type { UiExtensionsCopy } from "../features/extensions/ui-extensions-copy"
import { UiExtensionsDialog } from "../features/extensions/ui-extensions-dialog"

export function ExtensionsDialog(props: Omit<ComponentProps<typeof UiExtensionsDialog>, "copy">) {
  const t = useTranslations("app.extensions")
  const copy = {
    title: t("title"),
    description: t("description"),
    close: t("close"),
    loading: t("loading"),
    empty: t("empty"),
    installFile: t("installFile"),
    fileLabel: t("fileLabel"),
    reviewTitle: t("reviewTitle"),
    reviewDescription: t("reviewDescription"),
    permissions: t("permissions"),
    capabilityCommand: t("capabilityCommand"),
    capabilityPanel: t("capabilityPanel"),
    installAndEnable: t("installAndEnable"),
    cancel: t("cancel"),
    enabled: t("enabled"),
    disabled: t("disabled"),
    enable: t("enable"),
    disable: t("disable"),
    remove: t("remove"),
    openPanel: t("openPanel"),
    panelLoading: t("panelLoading"),
    panelFailed: t("panelFailed"),
    closePanel: t("closePanel"),
    reloadPanel: t("reloadPanel"),
    compute: t("compute"),
    invalidInputs: t("invalidInputs"),
    results: t("results"),
    sampleDownload: t("sampleDownload"),
    resetStore: t("resetStore"),
    resetStoreDescription: t("resetStoreDescription"),
    version: (version: string) => t("version", { version }),
    errors: {
      "invalid-package": t("errors.invalidPackage"),
      "package-too-large": t("errors.packageTooLarge"),
      "invalid-utf8": t("errors.invalidUtf8"),
      "integrity-mismatch": t("errors.integrityMismatch"),
      "invalid-store": t("errors.invalidStore"),
      "storage-unavailable": t("errors.storageUnavailable"),
      "store-full": t("errors.storeFull"),
      "identity-conflict": t("errors.identityConflict"),
      "not-installed": t("errors.notInstalled"),
      "permission-denied": t("errors.permissionDenied"),
      "stale-store": t("errors.staleStore"),
    },
  } satisfies UiExtensionsCopy
  return <UiExtensionsDialog {...props} copy={copy} />
}
