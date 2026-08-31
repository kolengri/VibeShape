import { Button } from "@vibeshape/ui/components/button"
import { Scan } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type RevolveParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
    profileSelectAriaLabel: string
    profileSelectHint: string
  }>

export function RevolveParameterPanel({
  copy,
  disabled = false,
  axisField,
  angleField,
  operationField,
  targetField,
  footerAction,
  message,
  onCancel,
  onProfileSelectionRequest,
  profileLabel,
  profileSelectionActive = false,
}: {
  copy: RevolveParameterPanelCopy
  disabled?: boolean
  axisField: ReactNode
  angleField: ReactNode
  operationField: ReactNode
  targetField?: ReactNode
  footerAction: ReactNode
  message?: ReactNode
  onCancel: () => void
  onProfileSelectionRequest?: (() => void) | undefined
  profileLabel: string
  profileSelectionActive?: boolean
}) {
  return (
    <ParameterPanel
      copy={copy}
      disabled={disabled}
      footerAction={footerAction}
      legend={copy.parameters}
      message={message}
      onCancel={onCancel}
    >
      <div className="grid gap-1 rounded-md border bg-panel-muted px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{copy.profile}</span>
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
              <span>{profileLabel}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.profileSelectHint}</TooltipContent>
        </Tooltip>
      </div>
      {operationField}
      {targetField}
      {axisField}
      {angleField}
    </ParameterPanel>
  )
}
