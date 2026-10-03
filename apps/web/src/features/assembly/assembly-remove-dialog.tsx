import { assemblyDefinitionIdSchema, assemblyInstanceIdSchema } from "@vibeshape/domain/assembly"
import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { useId, useState } from "react"

export type AssemblyRemoval = {
  kind: "definition" | "instance"
  id: string
  name: string
  revision: number
}
export function AssemblyRemoveDialog({
  removal,
  pending,
  error,
  onApply,
  onClose,
}: {
  removal: AssemblyRemoval
  pending: boolean
  error: string | null
  onApply: (changes: readonly AssemblyMutation[], revision: number) => Promise<boolean>
  onClose: () => void
}) {
  const t = useTranslations("app.assembly")
  const [cascade, setCascade] = useState(false)
  const id = useId()
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removeTitle", { name: removal.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("removeExplanation")}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field orientation="horizontal">
          <input
            id={id}
            type="checkbox"
            checked={cascade}
            disabled={pending}
            className="size-4 accent-primary"
            onChange={(event) => setCascade(event.currentTarget.checked)}
          />
          <FieldLabel htmlFor={id}>{t("cascadeRemoval")}</FieldLabel>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={async () => {
              const change: AssemblyMutation =
                removal.kind === "definition"
                  ? {
                      kind: "definition.remove",
                      definitionId: assemblyDefinitionIdSchema.parse(removal.id),
                      cascade,
                    }
                  : {
                      kind: "instance.remove",
                      instanceId: assemblyInstanceIdSchema.parse(removal.id),
                      cascade,
                    }
              if (await onApply([change], removal.revision)) onClose()
            }}
          >
            {t("remove")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
