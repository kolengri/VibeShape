import { Button } from "@vibeshape/ui/components/button"
import { Scan, Trash2, X } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type RevolveParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
    profileSelectAriaLabel: string
    profileSelectHint: string
    clearProfiles: string
    removeProfile: (profile: string) => string
  }>

export function RevolveParameterPanel({
  actions,
  copy,
  disabled = false,
  axisField,
  angleField,
  operationField,
  targetField,
  message,
  onProfileSelectionRequest,
  profileLabels,
  onProfileRemove,
  onProfilesClear,
  profileSelectionActive = false,
}: {
  actions: ReactNode
  copy: RevolveParameterPanelCopy
  disabled?: boolean
  axisField: ReactNode
  angleField: ReactNode
  operationField: ReactNode
  targetField?: ReactNode
  message?: ReactNode
  onProfileSelectionRequest?: (() => void) | undefined
  profileLabels: readonly string[]
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  profileSelectionActive?: boolean
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              className="h-auto min-h-8 justify-start gap-2 px-2 py-1 text-left"
              disabled={disabled || !onProfileSelectionRequest}
              variant={profileSelectionActive ? "secondary" : "ghost"}
              aria-label={copy.profileSelectAriaLabel}
              aria-pressed={profileSelectionActive}
              {...(onProfileSelectionRequest ? { onClick: onProfileSelectionRequest } : {})}
            >
              <Scan className="size-4 shrink-0" aria-hidden="true" />
              <span>{profileLabels.join(", ")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.profileSelectHint}</TooltipContent>
        </Tooltip>
        {profileLabels.map((label, index) =>
          onProfileRemove ? (
            <div key={label} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{label}</span>
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
            </div>
          ) : null,
        )}
      </div>
      {operationField}
      {targetField}
      {axisField}
      {angleField}
    </ParameterPanel>
  )
}
