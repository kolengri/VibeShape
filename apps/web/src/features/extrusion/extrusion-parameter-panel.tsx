import { Button } from "@vibeshape/ui/components/button"
import { Trash2, X } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type ExtrusionParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
    clearProfiles: string
    removeProfile: (profile: string) => string
  }>

export function ExtrusionParameterPanel({
  actions,
  copy,
  disabled = false,
  distanceField,
  message,
  profileLabels,
  onProfileRemove,
  onProfilesClear,
  operationField,
  symmetricField,
  targetField,
}: {
  actions: ReactNode
  copy: ExtrusionParameterPanelCopy
  disabled?: boolean
  distanceField: ReactNode
  message?: ReactNode
  profileLabels: readonly string[]
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  operationField: ReactNode
  symmetricField: ReactNode
  targetField?: ReactNode
}) {
  return (
    <ParameterPanel
      actions={actions}
      copy={copy}
      disabled={disabled}
      legend={copy.parameters}
      message={message}
    >
      <div className="grid gap-1 rounded-md border bg-panel-muted px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.profile}</span>
          {onProfilesClear ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={copy.clearProfiles}
                  disabled={disabled}
                  onClick={onProfilesClear}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.clearProfiles}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {profileLabels.map((label, index) => (
          <div key={label} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{label}</span>
            {onProfileRemove ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={copy.removeProfile(label)}
                    disabled={disabled}
                    onClick={() => onProfileRemove(index)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.removeProfile(label)}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ))}
      </div>
      {operationField}
      {targetField}
      {distanceField}
      <div className="pt-1">{symmetricField}</div>
    </ParameterPanel>
  )
}
