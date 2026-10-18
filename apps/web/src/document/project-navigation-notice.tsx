import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { type DocumentControllerState, dismissProjectNavigationError } from "./document-controller"
import { projectRecoveryUrl } from "./project-navigation"

export function ProjectNavigationNotice({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.projectNavigation")
  const error = controller.projectNavigationError
  if (!error) return null

  return (
    <div className="fixed left-1/2 top-12 z-50 w-full max-w-lg -translate-x-1/2 rounded-md border border-destructive bg-popover p-3 text-sm text-popover-foreground shadow-md">
      <p role="alert" aria-label={t("label")}>
        {t(error)}
      </p>
      <div className="mt-2 flex gap-2">
        {controller.status === "error" ? (
          <a
            className="underline underline-offset-4"
            href={projectRecoveryUrl(window.location.href)}
          >
            {t("recover")}
          </a>
        ) : (
          <Button size="sm" variant="outline" onClick={dismissProjectNavigationError}>
            {t("dismiss")}
          </Button>
        )}
      </div>
    </div>
  )
}
