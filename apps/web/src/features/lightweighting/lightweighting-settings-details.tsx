import type { ReactNode } from "react"

export function LightweightingSettingsDetails({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <details className="min-w-0 border-t pt-2">
      <summary className="cursor-pointer py-1 text-xs font-medium">{label}</summary>
      <div className="grid min-w-0 grid-cols-1 gap-3 pt-3">{children}</div>
    </details>
  )
}
