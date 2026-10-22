import type { DocumentDisplayUnits, VariableDefinition } from "@vibeshape/domain"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import { defaultLengthExpression, formatDisplayLength } from "../../document/document-display-units"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { parsePrimitiveLengthExpression } from "../part-design/primitive-form"
import {
  calculateFaceAlignment,
  type FaceAlignmentOrientation,
  type PlacementAlignmentFace,
  type PlacementAlignmentFaces,
  selectedAlignmentFace,
} from "./placement-face-alignment"
import type { PlacementValidationCopy } from "./placement-form-model"

function AlignmentStatus({ show, message }: { show: boolean; message: string }) {
  if (!show) return null
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {message}
    </p>
  )
}

function resolveAlignmentInput(input: {
  source: PlacementAlignmentFace | undefined
  target: PlacementAlignmentFace | undefined
  orientation: FaceAlignmentOrientation
  offset: string
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PlacementValidationCopy
  unavailable: string
}) {
  if (!input.source || !input.target) return { ok: false as const, message: input.unavailable }
  const parsed = parsePrimitiveLengthExpression(
    input.offset,
    input.variables,
    input.copy,
    (quantity) => Math.abs(quantity.value) <= 100_000,
    input.units.length,
  )
  if (!parsed.ok) return parsed
  const transform = calculateFaceAlignment(
    input.source,
    input.target,
    input.orientation,
    parsed.quantity.value,
  )
  return transform
    ? { ok: true as const, transform }
    : { ok: false as const, message: input.unavailable }
}

function AlignmentFaceField({
  options,
  selectedFace,
  selectedKey,
  onChange,
  units,
  label,
  useSelectedLabel,
}: {
  options: readonly PlacementAlignmentFace[]
  selectedFace: ViewerSelection | null | undefined
  selectedKey: string
  onChange: (key: string) => void
  units: DocumentDisplayUnits
  label: string
  useSelectedLabel: string
}) {
  const t = useTranslations("app.placement")
  const formatter = useFormatter()
  const selected = selectedAlignmentFace(options, selectedFace)
  const faceLabel = (face: PlacementAlignmentFace) =>
    t("alignmentFaceLabel", {
      body: face.bodyName,
      normal: face.normal.map((value) => formatter.number(value, "precise")).join(", "),
      center: face.center
        .map((value) => formatDisplayLength(value, units.length, formatter.number))
        .join(", "),
    })
  return (
    <div className="grid gap-1">
      <NativeSelectField
        label={label}
        value={options.some((face) => face.key === selectedKey) ? selectedKey : ""}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">{t("alignmentChooseFace")}</option>
        {options.map((face) => (
          <option key={face.key} value={face.key}>
            {faceLabel(face)}
          </option>
        ))}
      </NativeSelectField>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!selected}
        onClick={() => {
          if (selected) onChange(selected.key)
        }}
      >
        {useSelectedLabel}
      </Button>
    </div>
  )
}

export function PlacementAlignmentFields({
  faces,
  selectedFace,
  units,
  variables,
  copy,
  onAlign,
  onPickFaces,
  previewPaused,
}: {
  faces: PlacementAlignmentFaces
  selectedFace: ViewerSelection | null | undefined
  units: DocumentDisplayUnits
  variables: readonly VariableDefinition[]
  copy: PlacementValidationCopy
  onAlign: (transform: NonNullable<ReturnType<typeof calculateFaceAlignment>>) => void
  onPickFaces: () => void
  previewPaused: boolean
}) {
  const t = useTranslations("app.placement")
  const [sourceKey, setSourceKey] = useState("")
  const [targetKey, setTargetKey] = useState("")
  const [orientation, setOrientation] = useState<FaceAlignmentOrientation>("opposed")
  const [offset, setOffset] = useState(() => defaultLengthExpression(0, units.length))
  const [error, setError] = useState<string | null>(null)
  const [aligned, setAligned] = useState(false)
  const source = faces.source.find(({ key }) => key === sourceKey)
  const target = faces.targets.find(({ key }) => key === targetKey)
  const available = faces.source.length > 0 && faces.targets.length > 0
  const clearFeedback = () => {
    setError(null)
    setAligned(false)
    onPickFaces()
  }
  const calculate = () => {
    const result = resolveAlignmentInput({
      source,
      target,
      orientation,
      offset,
      variables,
      copy,
      units,
      unavailable: t("alignmentUnavailable"),
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    onAlign(result.transform)
    setError(null)
    setAligned(true)
  }
  return (
    <details open={available || undefined}>
      <summary className="cursor-pointer text-xs font-medium" aria-label={t("alignmentTitle")}>
        <span className="inline-flex items-center gap-1">
          <span>{t("alignmentTitle")}</span>
          <FieldHelp label={t("alignmentTitle")}>{t("alignmentDescription")}</FieldHelp>
        </span>
      </summary>
      <fieldset className="mt-2 grid gap-3 rounded-md border p-3">
        <legend className="sr-only">{t("alignmentTitle")}</legend>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            clearFeedback()
          }}
        >
          {t("alignmentPickFaces")}
        </Button>
        <AlignmentFaceField
          options={faces.source}
          selectedFace={selectedFace}
          selectedKey={sourceKey}
          units={units}
          label={t("alignmentSource")}
          useSelectedLabel={t("alignmentUseSource")}
          onChange={(key) => {
            clearFeedback()
            setSourceKey(key)
          }}
        />
        <AlignmentFaceField
          options={faces.targets}
          selectedFace={selectedFace}
          selectedKey={targetKey}
          units={units}
          label={t("alignmentTarget")}
          useSelectedLabel={t("alignmentUseTarget")}
          onChange={(key) => {
            clearFeedback()
            setTargetKey(key)
          }}
        />
        <NativeSelectField
          label={t("alignmentOrientation")}
          value={orientation}
          onChange={(event) => {
            clearFeedback()
            setOrientation(event.currentTarget.value === "same" ? "same" : "opposed")
          }}
        >
          <option value="opposed">{t("alignmentOpposed")}</option>
          <option value="same">{t("alignmentSame")}</option>
        </NativeSelectField>
        <LengthExpressionField
          id="placement-alignment-offset"
          value={offset}
          label={t("alignmentOffset")}
          description={t("alignmentOffsetDescription")}
          error={error}
          suggestions={[]}
          onValueChange={(value) => {
            clearFeedback()
            setOffset(value)
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!source || !target}
          onClick={calculate}
        >
          {t("alignmentCalculate")}
        </Button>
        <AlignmentStatus show={!available} message={t("alignmentUnavailable")} />
        <AlignmentStatus show={aligned} message={t("alignmentCalculated")} />
        <AlignmentStatus show={previewPaused} message={t("alignmentPreviewPaused")} />
      </fieldset>
    </details>
  )
}
