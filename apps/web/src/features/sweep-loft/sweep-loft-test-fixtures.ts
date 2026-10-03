import {
  documentSnapshotSchema,
  featureIdSchema,
  sketchProfileSelectorSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import messages from "../../i18n/messages/en.json"
import type { SweepLoftFormCopy } from "./sweep-loft-form"
import type { PathSketchOption, ProfileOption, SweepLoftFormMode } from "./sweep-loft-form-model"
export const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
export const featureId = featureIdSchema.parse(id(90))
export const profiles: ProfileOption[] = [1, 2, 3].map((value) => {
  const selector = sketchProfileSelectorSchema.parse({
    schemaVersion: 0,
    sketchId: id(value),
    outerBoundaryEntityIds: [id(value + 10)],
    holeBoundaryEntityIds: [],
  })
  return { selector, key: sketchProfileSelectorKey(selector), label: `Sketch ${value} · Profile 1` }
})
const pathSketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: id(4),
  label: "Path sketch",
  plane: "xz",
  entities: [
    {
      schemaVersion: 0,
      id: id(30),
      type: "point",
      x: 0,
      y: 0,
      construction: false,
    },
    {
      schemaVersion: 0,
      id: id(31),
      type: "point",
      x: 0,
      y: 10,
      construction: false,
    },
    {
      schemaVersion: 0,
      id: id(32),
      type: "point",
      x: 0,
      y: 20,
      construction: false,
    },
    {
      schemaVersion: 0,
      id: id(42),
      type: "line",
      startPointId: id(31),
      endPointId: id(32),
      construction: false,
    },
    {
      schemaVersion: 0,
      id: id(41),
      type: "line",
      startPointId: id(30),
      endPointId: id(31),
      construction: false,
    },
  ],
  constraints: [],
})
export const paths: PathSketchOption[] = [
  {
    sketch: pathSketch,
    curves: pathSketch.entities.flatMap((entity) =>
      entity.type === "line"
        ? [
            {
              id: entity.id,
              label: entity.id === id(41) ? "First line" : "Second line",
              startPointId: entity.startPointId,
              endPointId: entity.endPointId,
            },
          ]
        : [],
    ),
    points: pathSketch.entities.flatMap((entity) =>
      entity.type === "point"
        ? [{ id: entity.id, label: `Point ${Number(entity.id.slice(-2)) - 29}` }]
        : [],
    ),
  },
]
export const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(80),
  revision: 7,
  name: "Sweep and Loft",
  variables: [],
  sketches: [
    ...profiles.map(({ selector }, index) =>
      sketchRecordSchema.parse({
        schemaVersion: 0,
        id: selector.sketchId,
        label: `Sketch ${index + 1}`,
        plane: "xy",
        entities: [],
        constraints: [],
      }),
    ),
    pathSketch,
  ],
  features: [],
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
})
export const mode = (operation: "loft" | "sweep"): SweepLoftFormMode => ({
  kind: "create",
  operation,
  createFeatureId: () => featureId,
  featureLabel: `${operation === "loft" ? "Loft" : "Sweep"} 1`,
})
const source = messages.app.sweepLoft
export const copy: SweepLoftFormCopy = {
  ...source,
  title: source.loftTitle,
  description: source.loftDescription,
  submit: source.create,
  section: (number) => `Section ${number}`,
  unavailableSection: (number) => `Unavailable section ${number}`,
  removeSection: (profile) => `Remove section ${profile}`,
  moveEarlier: (number) => `Move section ${number} earlier`,
  moveLater: (number) => `Move section ${number} later`,
}
