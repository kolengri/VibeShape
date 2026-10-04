import { NativeSelect } from "@vibeshape/ui/components/native-select"
import {
  type PathSketchOption,
  type ProfileOption,
  type SweepLoftFormValues,
  selectedPathPointIds,
} from "./sweep-loft-form-model"
export type SweepPathCopy = Readonly<{
  profile: string
  chooseProfile: string
  pathSketch: string
  choosePath: string
  pathCurves: string
  pathDescription: string
  startPoint: string
  chooseStart: string
  unavailablePath: string
}>
export function SweepPathFields({
  values,
  profiles,
  paths,
  copy,
  onChange,
}: {
  values: SweepLoftFormValues
  profiles: readonly ProfileOption[]
  paths: readonly PathSketchOption[]
  copy: SweepPathCopy
  onChange: (values: Partial<SweepLoftFormValues>) => void
}) {
  return (
    <>
      <label htmlFor="sweep-profile" className="grid gap-2 text-sm">
        <span>{copy.profile}</span>
        <NativeSelect
          id="sweep-profile"
          aria-label={copy.profile}
          value={values.profileKey}
          onChange={(event) => onChange({ profileKey: event.currentTarget.value })}
        >
          <option value="">{copy.chooseProfile}</option>
          {profiles.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <SketchPathFields
        values={values}
        paths={paths}
        copy={copy}
        onChange={onChange}
        idPrefix="sweep"
      />
    </>
  )
}

export type SketchPathValues = Pick<
  SweepLoftFormValues,
  "pathSketchId" | "entityIds" | "startPointId"
>
export function SketchPathFields({
  values,
  paths,
  copy,
  onChange,
  idPrefix,
}: {
  values: SketchPathValues
  paths: readonly PathSketchOption[]
  copy: SweepPathCopy
  onChange: (values: Partial<SketchPathValues>) => void
  idPrefix: string
}) {
  const path = paths.find(({ sketch }) => sketch.id === values.pathSketchId)
  const points = selectedPathPointIds(path, values.entityIds)
  return (
    <>
      <label htmlFor={`${idPrefix}-path-sketch`} className="grid gap-2 text-sm">
        <span>{copy.pathSketch}</span>
        <NativeSelect
          id={`${idPrefix}-path-sketch`}
          aria-label={copy.pathSketch}
          value={values.pathSketchId}
          onChange={(event) =>
            onChange({ pathSketchId: event.currentTarget.value, entityIds: [], startPointId: "" })
          }
        >
          <option value="">{copy.choosePath}</option>
          {paths.map(({ sketch }) => (
            <option key={sketch.id} value={sketch.id}>
              {sketch.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium">{copy.pathCurves}</legend>
        {path ? (
          path.curves.map(({ id, label }) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.entityIds.includes(id)}
                onChange={(event) => {
                  const ids = event.currentTarget.checked
                    ? [...values.entityIds, id].sort()
                    : values.entityIds.filter((entityId) => entityId !== id)
                  const remaining = selectedPathPointIds(path, ids)
                  onChange({
                    entityIds: ids,
                    startPointId: remaining.has(values.startPointId) ? values.startPointId : "",
                  })
                }}
              />
              {label}
            </label>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{copy.unavailablePath}</p>
        )}
        <p className="text-xs text-muted-foreground">{copy.pathDescription}</p>
      </fieldset>
      <label htmlFor={`${idPrefix}-start-point`} className="grid gap-2 text-sm">
        <span>{copy.startPoint}</span>
        <NativeSelect
          id={`${idPrefix}-start-point`}
          aria-label={copy.startPoint}
          value={values.startPointId}
          onChange={(event) => onChange({ startPointId: event.currentTarget.value })}
        >
          <option value="">{copy.chooseStart}</option>
          {path?.points
            .filter(({ id }) => points.has(id))
            .map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </NativeSelect>
      </label>
    </>
  )
}
