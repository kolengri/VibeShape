import type { SketchProfileSelector } from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { Input } from "@vibeshape/ui/components/input"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { useId } from "react"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import {
  emptyLoftPath,
  type LoftConstraintValues,
  type LoftEndValues,
  type LoftPathValues,
  type LoftSupportOption,
  loftSupportKey,
} from "./loft-constraint-model"
import type { PathSketchOption } from "./sweep-loft-form-model"
import { SketchPathFields, type SweepPathCopy } from "./sweep-path-fields"

export type LoftConstraintCopy = {
  constrained: string
  constraintsDescription: string
  outerTracks: string
  addTrack: string
  chooseSegment: string
  unavailableSegment: string
  vertexTrack: string
  segmentTrack: string
  addRail: string
  addGuide: string
  guideName: string
  startContinuity: string
  endContinuity: string
  addEnd: string
  supportFace: string
  chooseSupport: string
  unavailableSupport: string
  continuity: string
  remove: string
  guideContinuity: string
  track: (number: number) => string
  directedSegment: (track: number, section: number) => string
  directionOption: (curve: string, point: string) => string
  rail: (number: number) => string
  guide: (number: number) => string
  endConstraint: (number: number) => string
}
function TrackPicker({
  value,
  count,
  label,
  copy,
  onChange,
}: {
  value: number
  count: number
  label: string
  copy: LoftConstraintCopy
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={fieldVariants({ orientation: "horizontal" })}>
      <span>{label}</span>
      <NativeSelect
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      >
        {Array.from({ length: count }, (_, index) => (
          <option key={index} value={index}>
            {copy.track(index + 1)}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}
function DirectedSegmentField({
  track,
  sectionIndex,
  section,
  paths,
  copy,
  onChange,
}: {
  track: LoftConstraintValues["outerCorrespondence"][number]
  sectionIndex: number
  section: SketchProfileSelector
  paths: readonly PathSketchOption[]
  copy: {
    label: string
    directionOption: LoftConstraintCopy["directionOption"]
    chooseSegment: string
    unavailableSegment: string
  }
  onChange: (track: LoftConstraintValues["outerCorrespondence"][number]) => void
}) {
  const path = paths.find(({ sketch }) => sketch.id === section.sketchId)
  const options =
    path?.curves
      .filter(({ id }) => section.outerBoundaryEntityIds.includes(id))
      .flatMap((curve) =>
        [curve.startPointId, curve.endPointId].map((point) => ({
          key: `${curve.id}:${point}`,
          entity: curve.id,
          point,
          label: copy.directionOption(
            curve.label,
            path.points.find(({ id }) => id === point)?.label ?? point,
          ),
        })),
      ) ?? []
  const entity = track.sectionEntityIds[sectionIndex],
    point = track.sectionStartPointIds[sectionIndex]
  const value = entity && point ? `${entity}:${point}` : ""
  const id = useId()
  return (
    <label htmlFor={id} className={fieldVariants({ orientation: "horizontal" })}>
      <span>{copy.label}</span>
      <NativeSelect
        id={id}
        aria-label={copy.label}
        value={value}
        onChange={(event) => {
          const option = options.find(({ key }) => key === event.currentTarget.value)
          const sectionEntityIds = [...track.sectionEntityIds],
            sectionStartPointIds = [...track.sectionStartPointIds]
          sectionEntityIds[sectionIndex] = option?.entity ?? ""
          sectionStartPointIds[sectionIndex] = option?.point ?? ""
          onChange({ sectionEntityIds, sectionStartPointIds })
        }}
      >
        <option value="">{copy.chooseSegment}</option>
        {value && !options.some(({ key }) => key === value) && (
          <option value={value}>{copy.unavailableSegment}</option>
        )}
        {options.map(({ key, label }) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}
function LoftPathFields({
  value,
  paths,
  copy,
  idPrefix,
  onChange,
}: {
  value: LoftPathValues
  paths: readonly PathSketchOption[]
  copy: SweepPathCopy
  idPrefix: string
  onChange: (path: LoftPathValues) => void
}) {
  return (
    <SketchPathFields
      values={{
        pathSketchId: value.sketchId,
        entityIds: value.entityIds,
        startPointId: value.startPointId,
      }}
      paths={paths}
      copy={copy}
      idPrefix={idPrefix}
      onChange={(changes) =>
        onChange({
          sketchId: changes.pathSketchId ?? value.sketchId,
          entityIds: changes.entityIds ?? value.entityIds,
          startPointId: changes.startPointId ?? value.startPointId,
        })
      }
    />
  )
}
function EndFields({
  title,
  values,
  count,
  supports,
  copy,
  onChange,
}: {
  title: string
  values: LoftEndValues[]
  count: number
  supports: readonly LoftSupportOption[]
  copy: LoftConstraintCopy
  onChange: (values: LoftEndValues[]) => void
}) {
  const id = useId()
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-xs font-medium">{title}</legend>
      {values.map((value, index) => {
        const key = value.support ? loftSupportKey(value.support) : ""
        const update = (changes: Partial<LoftEndValues>) =>
          onChange(values.map((old, row) => (row === index ? { ...old, ...changes } : old)))
        return (
          <fieldset key={index} className="grid gap-2 rounded-md border p-3">
            <legend className="text-xs font-medium">{copy.endConstraint(index + 1)}</legend>
            <TrackPicker
              value={value.segmentTrack}
              count={count}
              label={copy.segmentTrack}
              copy={copy}
              onChange={(segmentTrack) => update({ segmentTrack })}
            />
            <label
              htmlFor={`${id}-${index}-continuity`}
              className={fieldVariants({ orientation: "horizontal" })}
            >
              <span>{copy.continuity}</span>
              <NativeSelect
                id={`${id}-${index}-continuity`}
                aria-label={copy.continuity}
                value={value.continuity}
                onChange={(event) =>
                  update({ continuity: event.currentTarget.value === "G2" ? "G2" : "G1" })
                }
              >
                <option value="G1">G1</option>
                <option value="G2">G2</option>
              </NativeSelect>
            </label>
            <label
              htmlFor={`${id}-${index}-support`}
              className={fieldVariants({ orientation: "horizontal" })}
            >
              <span>{copy.supportFace}</span>
              <NativeSelect
                id={`${id}-${index}-support`}
                aria-label={copy.supportFace}
                value={key}
                onChange={(event) =>
                  update({
                    support:
                      supports.find((option) => option.key === event.currentTarget.value)
                        ?.reference ?? null,
                  })
                }
              >
                <option value="">{copy.chooseSupport}</option>
                {key && !supports.some((option) => option.key === key) && (
                  <option value={key}>{copy.unavailableSupport}</option>
                )}
                {supports.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChange(values.filter((_, row) => row !== index))}
            >
              {copy.remove}
            </Button>
          </fieldset>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={count === 0 || values.length >= count}
        onClick={() => onChange([...values, { segmentTrack: 0, continuity: "G1", support: null }])}
      >
        {copy.addEnd}
      </Button>
    </fieldset>
  )
}
function removeTrack(values: LoftConstraintValues, index: number): Partial<LoftConstraintValues> {
  const segment = <T extends { segmentTrack: number }>(items: T[]) =>
    items
      .filter((item) => item.segmentTrack !== index)
      .map((item) => ({
        ...item,
        segmentTrack: item.segmentTrack > index ? item.segmentTrack - 1 : item.segmentTrack,
      }))
  return {
    outerCorrespondence: values.outerCorrespondence.filter((_, row) => row !== index),
    rails: values.rails
      .filter(({ vertexTrack }) => vertexTrack !== index)
      .map((rail) => ({
        ...rail,
        vertexTrack: rail.vertexTrack > index ? rail.vertexTrack - 1 : rail.vertexTrack,
      })),
    guides: segment(values.guides),
    start: segment(values.start),
    end: segment(values.end),
  }
}
export function LoftConstraintFields({
  values,
  sections,
  paths,
  supports,
  copy,
  onChange,
}: {
  values: LoftConstraintValues
  sections: readonly SketchProfileSelector[]
  paths: readonly PathSketchOption[]
  supports: readonly LoftSupportOption[]
  copy: LoftConstraintCopy & SweepPathCopy
  onChange: (changes: Partial<LoftConstraintValues>) => void
}) {
  const count = values.outerCorrespondence.length
  return (
    <>
      <BooleanParameterField
        label={copy.constrained}
        description={copy.constraintsDescription}
        checked={values.constrained}
        onChange={(event) => onChange({ constrained: event.currentTarget.checked })}
      />
      {values.constrained && (
        <>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-xs font-medium">{copy.outerTracks}</legend>
            {values.outerCorrespondence.map((track, index) => (
              <fieldset key={index} className="grid gap-2 rounded-md border p-3">
                <legend className="text-xs font-medium">{copy.track(index + 1)}</legend>
                {sections.map((section, sectionIndex) => (
                  <DirectedSegmentField
                    key={section.sketchId}
                    track={track}
                    sectionIndex={sectionIndex}
                    section={section}
                    paths={paths}
                    copy={{ ...copy, label: copy.directedSegment(index + 1, sectionIndex + 1) }}
                    onChange={(updated) =>
                      onChange({
                        outerCorrespondence: values.outerCorrespondence.map((old, row) =>
                          row === index ? updated : old,
                        ),
                      })
                    }
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onChange(removeTrack(values, index))}
                >
                  {copy.remove}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={count >= 64 || sections.length < 2}
              onClick={() =>
                onChange({
                  outerCorrespondence: [
                    ...values.outerCorrespondence,
                    {
                      sectionEntityIds: sections.map(() => ""),
                      sectionStartPointIds: sections.map(() => ""),
                    },
                  ],
                })
              }
            >
              {copy.addTrack}
            </Button>
          </fieldset>
          <LoftRailFields values={values} paths={paths} copy={copy} onChange={onChange} />
          <LoftGuideFields values={values} paths={paths} copy={copy} onChange={onChange} />
          <EndFields
            title={copy.startContinuity}
            values={values.start}
            count={count}
            supports={supports}
            copy={copy}
            onChange={(start) => onChange({ start })}
          />
          <EndFields
            title={copy.endContinuity}
            values={values.end}
            count={count}
            supports={supports}
            copy={copy}
            onChange={(end) => onChange({ end })}
          />
        </>
      )}
    </>
  )
}
function LoftRailFields({
  values,
  paths,
  copy,
  onChange,
}: {
  values: LoftConstraintValues
  paths: readonly PathSketchOption[]
  copy: LoftConstraintCopy & SweepPathCopy
  onChange: (changes: Partial<LoftConstraintValues>) => void
}) {
  return (
    <>
      {values.rails.map((rail, index) => {
        const update = (changes: Partial<typeof rail>) =>
          onChange({
            rails: values.rails.map((old, row) => (row === index ? { ...old, ...changes } : old)),
          })
        return (
          <fieldset key={index} className="grid gap-2 rounded-md border p-3">
            <legend className="text-xs font-medium">{copy.rail(index + 1)}</legend>
            <TrackPicker
              value={rail.vertexTrack}
              count={values.outerCorrespondence.length}
              label={copy.vertexTrack}
              copy={copy}
              onChange={(vertexTrack) => update({ vertexTrack })}
            />
            <LoftPathFields
              value={rail.path}
              paths={paths}
              copy={copy}
              idPrefix={`loft-rail-${index}`}
              onChange={(path) => update({ path })}
            />
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChange({ rails: values.rails.filter((_, row) => row !== index) })}
            >
              {copy.remove}
            </Button>
          </fieldset>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={
          !values.outerCorrespondence.length ||
          values.rails.length >= values.outerCorrespondence.length
        }
        onClick={() =>
          onChange({ rails: [...values.rails, { vertexTrack: 0, path: emptyLoftPath() }] })
        }
      >
        {copy.addRail}
      </Button>
    </>
  )
}
function LoftGuideFields({
  values,
  paths,
  copy,
  onChange,
}: {
  values: LoftConstraintValues
  paths: readonly PathSketchOption[]
  copy: LoftConstraintCopy & SweepPathCopy
  onChange: (changes: Partial<LoftConstraintValues>) => void
}) {
  const id = useId()
  return (
    <>
      {values.guides.map((guide, index) => {
        const update = (changes: Partial<typeof guide>) =>
          onChange({
            guides: values.guides.map((old, row) => (row === index ? { ...old, ...changes } : old)),
          })
        return (
          <fieldset
            key={index}
            aria-label={copy.guide(index + 1)}
            className="grid gap-2 rounded-md border p-3"
          >
            <legend className="text-xs font-medium">
              <span className="inline-flex items-center gap-1">
                {copy.guide(index + 1)}
                <FieldHelp label={copy.guide(index + 1)}>{copy.guideContinuity}</FieldHelp>
              </span>
            </legend>
            <label
              htmlFor={`${id}-${index}-name`}
              className={fieldVariants({ orientation: "horizontal" })}
            >
              <span>{copy.guideName}</span>
              <Input
                id={`${id}-${index}-name`}
                aria-label={copy.guideName}
                value={guide.name}
                onChange={(event) => update({ name: event.currentTarget.value })}
              />
            </label>
            <TrackPicker
              value={guide.segmentTrack}
              count={values.outerCorrespondence.length}
              label={copy.segmentTrack}
              copy={copy}
              onChange={(segmentTrack) => update({ segmentTrack })}
            />
            <LoftPathFields
              value={guide.path}
              paths={paths}
              copy={copy}
              idPrefix={`loft-guide-${index}`}
              onChange={(path) => update({ path })}
            />
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChange({ guides: values.guides.filter((_, row) => row !== index) })}
            >
              {copy.remove}
            </Button>
          </fieldset>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!values.outerCorrespondence.length || values.guides.length >= 64}
        onClick={() =>
          onChange({
            guides: [
              ...values.guides,
              { name: "", segmentTrack: 0, continuity: "C0", path: emptyLoftPath() },
            ],
          })
        }
      >
        {copy.addGuide}
      </Button>
    </>
  )
}
