import { useTranslations } from "@vibeshape/i18n"
import { useBlockingActivity, useReportBlockingActivity } from "@vibeshape/ui/components/activity"
import { BlockingLoader } from "@vibeshape/ui/components/blocking-loader"
import {
  type DocumentControllerState,
  useProjectNavigationPending,
} from "../document/document-controller"

export function ApplicationActivity({ status }: { status: DocumentControllerState["status"] }) {
  const t = useTranslations("app.shell.applicationBar")
  const navigationPending = useProjectNavigationPending()
  useReportBlockingActivity(
    navigationPending || status === "idle" || status === "loading",
    t("loading"),
  )
  return <BlockingLoader label={useBlockingActivity()} />
}
