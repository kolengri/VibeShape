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
      <summary className="cursor-pointer py-1 text-sm font-medium">{label}</summary>
      <div className="grid min-w-0 grid-cols-1 gap-2 pt-2">{children}</div>
    </details>
  )
}
