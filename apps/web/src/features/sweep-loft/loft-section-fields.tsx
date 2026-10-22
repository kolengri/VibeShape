import type { SketchProfileSelector } from "@vibeshape/domain"
import { MAX_LOFT_SECTIONS } from "@vibeshape/domain/part-design-loft"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { useRef, useState } from "react"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import { ProfileSelectionField } from "../part-design/profile-selection-field"
import { type ProfileOption, reorderLoftSection } from "./sweep-loft-form-model"

export type LoftSectionCopy = Readonly<{
  sectionProfile: string
  chooseProfile: string
  addSection: string
  removeSection: (label: string) => string
  section: (number: number) => string
  unavailableSection: (number: number) => string
  moveEarlier: (number: number) => string
  moveLater: (number: number) => string
  ruled: string
  ruledDescription: string
}>
export function LoftSectionFields({
  sections,
  ruled,
  profiles,
  copy,
  onSectionsChange,
  onRuledChange,
  ruledDisabled = false,
}: {
  sections: readonly SketchProfileSelector[]
  ruled: boolean
  profiles: readonly ProfileOption[]
  copy: LoftSectionCopy
  onSectionsChange: (sections: SketchProfileSelector[]) => void
  onRuledChange: (value: boolean) => void
  ruledDisabled?: boolean
}) {
  const [candidate, setCandidate] = useState("")
  const picker = useRef<HTMLSelectElement>(null)
  const selectedKeys = new Set(sections.map(sketchProfileSelectorKey))
  const available = profiles.filter(({ key }) => !selectedKeys.has(key))
  return (
    <>
      <label
        htmlFor="loft-section-profile"
        className={fieldVariants({ orientation: "horizontal" })}
      >
        <span>{copy.sectionProfile}</span>
        <NativeSelect
          id="loft-section-profile"
          ref={picker}
          aria-label={copy.sectionProfile}
          value={candidate}
          onChange={(event) => setCandidate(event.currentTarget.value)}
        >
          <option value="">{copy.chooseProfile}</option>
          {available.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={
          sections.length >= MAX_LOFT_SECTIONS || !available.some(({ key }) => key === candidate)
        }
        onClick={() => {
          const option = available.find(({ key }) => key === candidate)
          if (option) {
            onSectionsChange([...sections, option.selector])
            setCandidate("")
            picker.current?.focus()
          }
        }}
      >
        {copy.addSection}
      </Button>
      <ol className="grid gap-3" aria-label={copy.sectionProfile}>
        {sections.map((selector, index) => {
          const label =
            profiles.find(({ key }) => key === sketchProfileSelectorKey(selector))?.label ??
            copy.unavailableSection(index + 1)
          return (
            <li className="grid gap-1" key={sketchProfileSelectorKey(selector)}>
              <ProfileSelectionField
                copy={{
                  label: copy.section(index + 1),
                  remove: copy.removeSection,
                  clear: "",
                  select: "",
                }}
                labels={[label]}
                onRemove={() =>
                  onSectionsChange(sections.filter((_, selectedIndex) => selectedIndex !== index))
                }
              />
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={copy.moveEarlier(index + 1)}
                  disabled={index === 0}
                  onClick={() => onSectionsChange(reorderLoftSection(sections, index, -1))}
                >
                  {copy.moveEarlier(index + 1)}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={copy.moveLater(index + 1)}
                  disabled={index === sections.length - 1}
                  onClick={() => onSectionsChange(reorderLoftSection(sections, index, 1))}
                >
                  {copy.moveLater(index + 1)}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      <BooleanParameterField
        label={copy.ruled}
        description={copy.ruledDescription}
        checked={ruled}
        disabled={ruledDisabled}
        onChange={(event) => onRuledChange(event.currentTarget.checked)}
      />
    </>
  )
}
