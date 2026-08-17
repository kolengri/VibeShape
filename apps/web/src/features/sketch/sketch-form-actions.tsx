import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"

export function SketchFormActions({
  cancelLabel,
  submit,
  onCancel,
}: Readonly<{
  cancelLabel: string
  submit: ReactNode
  onCancel: () => void
}>) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      {submit}
    </div>
  )
}
