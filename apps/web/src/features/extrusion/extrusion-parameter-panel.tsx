import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import { ProfileSelectionField } from "../part-design/profile-selection-field"

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
      <ProfileSelectionField
        copy={{
          clear: copy.clearProfiles,
          label: copy.profile,
          remove: copy.removeProfile,
          select: copy.profile,
        }}
        disabled={disabled}
        labels={profileLabels}
        onClear={onProfilesClear}
        onRemove={onProfileRemove}
      />
      {operationField}
      {targetField}
      {distanceField}
      <div className="pt-1">{symmetricField}</div>
    </ParameterPanel>
  )
}
