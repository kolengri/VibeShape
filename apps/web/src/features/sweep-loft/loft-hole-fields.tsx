import type { SketchEntityId, SketchProfileSelector } from "@vibeshape/domain"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { NativeSelect } from "@vibeshape/ui/components/native-select"

type HoleTrack = { sectionBoundaryEntityIds: SketchEntityId[][] }
export function LoftHoleFields({
  sections,
  tracks,
  onChange,
}: {
  sections: readonly SketchProfileSelector[]
  tracks: readonly HoleTrack[]
  onChange: (tracks: HoleTrack[]) => void
}) {
  const t = useTranslations("app.partDesign.loftHoles")
  const count = sections[0]?.holeBoundaryEntityIds.length ?? 0
  if (!sections.some(({ holeBoundaryEntityIds }) => holeBoundaryEntityIds.length)) return null
  return (
    <fieldset className="grid gap-3" aria-label={t("title")}>
      <legend className="text-xs font-medium">
        <span className="inline-flex items-center gap-1">
          {t("title")}
          <FieldHelp label={t("title")}>{t("description")}</FieldHelp>
        </span>
      </legend>
      {tracks.map((track, trackIndex) => (
        <div key={trackIndex} className="grid gap-2 rounded border p-2">
          {sections.map((section, sectionIndex) => (
            <Field key={sketchProfileSelectorKey(section)}>
              <FieldLabel htmlFor={`loft-hole-${trackIndex}-${sectionIndex}`}>
                {t("boundary", { track: trackIndex + 1, section: sectionIndex + 1 })}
              </FieldLabel>
              <NativeSelect
                id={`loft-hole-${trackIndex}-${sectionIndex}`}
                value={JSON.stringify(track.sectionBoundaryEntityIds[sectionIndex] ?? [])}
                onChange={(event) => {
                  const boundary =
                    section.holeBoundaryEntityIds.find(
                      (ids) => JSON.stringify(ids) === event.target.value,
                    ) ?? []
                  onChange(
                    tracks.map((current, index) =>
                      index === trackIndex
                        ? {
                            sectionBoundaryEntityIds: sections.map((_, i) =>
                              i === sectionIndex
                                ? [...boundary]
                                : [...(current.sectionBoundaryEntityIds[i] ?? [])],
                            ),
                          }
                        : current,
                    ),
                  )
                }}
              >
                <option value="[]">{t("choose")}</option>
                {section.holeBoundaryEntityIds.map((ids, index) => (
                  <option key={JSON.stringify(ids)} value={JSON.stringify(ids)}>
                    {t("hole", { number: index + 1 })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ))}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => onChange(tracks.filter((_, index) => index !== trackIndex))}
          >
            {t("remove", { number: trackIndex + 1 })}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={tracks.length >= count}
        onClick={() => onChange([...tracks, { sectionBoundaryEntityIds: sections.map(() => []) }])}
      >
        {t("add")}
      </Button>
    </fieldset>
  )
}
