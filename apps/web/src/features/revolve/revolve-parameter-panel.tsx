import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import { ProfileSelectionField } from "../part-design/profile-selection-field"
import type { FeaturePreviewState } from "../preview/use-feature-preview"

export type RevolveParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
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
  previewStatus,
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
  previewStatus?: FeaturePreviewState["status"] | undefined
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
      previewStatus={previewStatus}
    >
      <ProfileSelectionField
        copy={{
          clear: copy.clearProfiles,
          label: copy.profile,
          remove: copy.removeProfile,
          select: copy.profileSelectHint,
        }}
        disabled={disabled}
        labels={profileLabels}
        onClear={onProfilesClear}
        onRemove={onProfileRemove}
        onSelectionRequest={onProfileSelectionRequest}
        selectionActive={profileSelectionActive}
      />
      {operationField}
      {targetField}
      {axisField}
      {angleField}
    </ParameterPanel>
  )
}
