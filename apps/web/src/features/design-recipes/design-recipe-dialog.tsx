import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { Textarea } from "@vibeshape/ui/components/textarea"
import { useId } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { useDesignRecipe } from "./use-design-recipe"

type Session = ReturnType<typeof useDesignRecipe>
type Props = {
  controller: DocumentControllerState
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

function RecipeActions({ session, hasSnapshot }: { session: Session; hasSnapshot: boolean }) {
  const t = useTranslations("app.designRecipes")
  const busy = Boolean(session.phase)
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || !hasSnapshot} onClick={session.capture}>
        {t("export")}
      </Button>
      <Button variant="outline" disabled={busy} onClick={session.example}>
        {t("example")}
      </Button>
      {session.recording ? (
        <>
          <Button disabled={busy} onClick={session.stop}>
            {t("stop")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={session.discard}>
            {t("discard")}
          </Button>
        </>
      ) : (
        <Button variant="outline" disabled={busy || !session.writable} onClick={session.record}>
          {t("start")}
        </Button>
      )}
      <Button variant="outline" disabled={busy || !session.code} onClick={session.download}>
        {t("download")}
      </Button>
    </div>
  )
}

function RecipeStatus({ session }: { session: Session }) {
  const t = useTranslations("app.designRecipes")
  const message = session.phase
    ? t(session.phase === "preview" ? "previewing" : "applying")
    : session.status
  return (
    <>
      {session.recording && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("recording")}
        </p>
      )}
      {session.prepared?.renamedVariables.length ? (
        <p className="text-sm">
          {t("renamed", { names: session.prepared.renamedVariables.join(", ") })}
        </p>
      ) : null}
      {session.error && <Alert role="alert">{session.error}</Alert>}
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
      {session.prepared && !session.current && <Alert role="alert">{t("stale")}</Alert>}
    </>
  )
}

function RecipeFooter({ session }: { session: Session }) {
  const t = useTranslations("app.designRecipes")
  const busy = Boolean(session.phase)
  return (
    <DialogFooter>
      <Button variant="ghost" disabled={session.phase === "apply"} onClick={session.close}>
        {session.phase === "preview" ? t("cancel") : t("close")}
      </Button>
      <Button
        variant="outline"
        disabled={!session.code || !session.writable || busy}
        aria-busy={session.phase === "preview" || undefined}
        onClick={session.preview}
      >
        {t("preview")}
      </Button>
      <Button
        disabled={!session.prepared || !session.current || !session.writable || busy}
        aria-busy={session.phase === "apply" || undefined}
        onClick={session.apply}
      >
        {t("apply")}
      </Button>
    </DialogFooter>
  )
}

export function DesignRecipeDialog({ controller, open, onOpenChange, onCloseAutoFocus }: Props) {
  const t = useTranslations("app.designRecipes")
  const editorId = useId()
  const session = useDesignRecipe(controller, onOpenChange)
  return (
    <Dialog open={open} onOpenChange={session.changeOpen}>
      <DialogContent
        className="sm:max-w-3xl"
        closeLabel={t("close")}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <RecipeActions session={session} hasSnapshot={Boolean(controller.authoredSnapshot)} />
          <p className="text-sm text-muted-foreground">{t("recordingScope")}</p>
          <label htmlFor={editorId} className="text-sm font-medium">
            {t("code")}
          </label>
          <Textarea
            id={editorId}
            className="min-h-72 font-mono text-xs"
            value={session.code}
            spellCheck={false}
            disabled={Boolean(session.phase)}
            onChange={(event) => session.edit(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("runtime")}</p>
          <RecipeStatus session={session} />
        </DialogBody>
        <RecipeFooter session={session} />
      </DialogContent>
    </Dialog>
  )
}
