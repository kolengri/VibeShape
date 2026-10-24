import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import { ProfileSelectionField } from "../part-design/profile-selection-field"
import type { FeaturePreviewState } from "../preview/use-feature-preview"

export type ExtrusionParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
    clearProfiles: string
    removeProfile: (profile: string) => string
    selectProfiles?: string
    profileSelectionDescription?: string
  }>

export function ExtrusionParameterPanel({
  actions,
  copy,
  disabled = false,
  distanceField,
  message,
  previewStatus,
  previewErrorHandled,
  profileLabels,
  onProfileRemove,
  onProfilesClear,
  onProfileSelectionRequest,
  operationField,
  symmetricField,
  extentFields,
  targetField,
}: {
  actions: ReactNode
  copy: ExtrusionParameterPanelCopy
  disabled?: boolean
  distanceField: ReactNode
  message?: ReactNode
  previewStatus?: FeaturePreviewState["status"] | undefined
  previewErrorHandled?: boolean | undefined
  profileLabels: readonly string[]
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  onProfileSelectionRequest?: (() => void) | undefined
  operationField: ReactNode
  symmetricField: ReactNode
  extentFields?: ReactNode
  targetField?: ReactNode
}) {
  return (
    <ParameterPanel
      actions={actions}
      copy={copy}
      disabled={disabled}
      legend={copy.parameters}
      message={message}
      previewStatus={previewStatus}
      previewErrorHandled={previewErrorHandled}
    >
      <ProfileSelectionField
        copy={{
          clear: copy.clearProfiles,
          label: copy.profile,
          remove: copy.removeProfile,
          select: copy.selectProfiles ?? copy.profile,
        }}
        disabled={disabled}
        labels={profileLabels}
        onClear={onProfilesClear}
        onRemove={onProfileRemove}
        onSelectionRequest={onProfileSelectionRequest}
        selectionActive={onProfileSelectionRequest !== undefined}
      />
      {copy.profileSelectionDescription ? (
        <p className="text-xs text-muted-foreground">{copy.profileSelectionDescription}</p>
      ) : null}
      {operationField}
      {targetField}
      {distanceField}
      <div className="pt-1">{symmetricField}</div>
      {extentFields}
    </ParameterPanel>
  )
}
