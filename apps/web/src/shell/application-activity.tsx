import { useBlockingActivity, useReportActivity } from "@vibeshape/ui/components/activity"
import { BlockingLoader } from "@vibeshape/ui/components/blocking-loader"
import {
  type DocumentControllerState,
  useProjectNavigationPending,
} from "../document/document-controller"

export function ApplicationActivity({ status }: { status: DocumentControllerState["status"] }) {
  const navigationPending = useProjectNavigationPending()
  useReportActivity(navigationPending || status === "idle" || status === "loading")
  return <BlockingLoader label={useBlockingActivity()} />
}
