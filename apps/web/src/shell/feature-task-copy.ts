type StatusCopyKey =
  | "unavailable"
  | "validationSummary"
  | "invalidExpression"
  | "invalidDimension"
  | "invalidRange"
  | "staleRevision"
  | "saveFailed"
  | "previewFailed"

/** Status and validation copy that each previewed exact-body task reads from its own namespace. */
export function previewedTaskStatusCopy(
  t: (key: StatusCopyKey) => string,
): Readonly<Record<StatusCopyKey, string>> {
  return {
    unavailable: t("unavailable"),
    validationSummary: t("validationSummary"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
    previewFailed: t("previewFailed"),
  }
}
