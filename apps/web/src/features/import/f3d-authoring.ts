import {
  featureRecordSchema,
  type insertFeatureInHistoryCommandSchema,
  insertSketchInHistoryCommandSchema,
} from "@vibeshape/domain"
import type { CommandActor } from "@vibeshape/domain/commands"
import { documentCommandSchema } from "@vibeshape/domain/commands"
import { sketchEntityIdSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import { extrusionFeatureType } from "@vibeshape/domain/part-design"
import { authorPreparedPlanarImport } from "@vibeshape/domain/planar-import-authoring"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { type F3dPreparation, f3dSketchData } from "@vibeshape/formats/f3d"
import type { SourceImportInspection } from "@vibeshape/protocol"
import type { ImportDocumentContext } from "./import-model"

/** Promotion requires a single analytic cylinder matching the recovered source. */
export function f3dCylinderMatches(plan: F3dPreparation, inspection: SourceImportInspection) {
  const cylinder = plan.cylinder
  const signature = inspection.outputs.length === 1 ? inspection.outputs[0]?.signature : null
  if (!cylinder || !signature || signature.faceCount !== 3 || signature.edgeCount !== 6)
    return false
  const { x, y, radius: r, distance: d } = cylinder
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-5, Math.abs(b) * 1e-6)
  return (
    close(signature.volume, Math.PI * r * r * d) &&
    close(signature.area, 2 * Math.PI * r * (r + d)) &&
    signature.centroid.every((v, i) => close(v, [x, y, d / 2][i] ?? 0)) &&
    signature.bounds.min.every((v, i) => close(v, [x - r, y - r, 0][i] ?? 0)) &&
    signature.bounds.max.every((v, i) => close(v, [x + r, y + r, d][i] ?? 0))
  )
}

export function authorF3dRecords(
  plan: F3dPreparation,
  context: ImportDocumentContext,
  inspection: SourceImportInspection,
  envelope: () => {
    commandId: string
    documentId: string
    baseRevision: number
    issuedAt: string
    actor: CommandActor
  },
  uuid: () => string,
) {
  const commands: (
    | ReturnType<typeof documentCommandSchema.parse>
    | ReturnType<typeof insertSketchInHistoryCommandSchema.parse>
    | ReturnType<typeof insertFeatureInHistoryCommandSchema.parse>
  )[] = []
  let historyAfter = context.historyAfter
  const sketches = new Map<number, ReturnType<typeof authorPreparedPlanarImport>>()
  for (const parameter of plan.parameters) {
    const id = uuid()
    const sourceName = parameter.name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32)
    commands.push(
      documentCommandSchema.parse({
        ...envelope(),
        schemaVersion: 1,
        kind: "org.vibeshape.variable.add",
        payload: {
          variable: {
            schemaVersion: 0,
            id,
            name: `f3d_${sourceName}_${id.slice(-12)}`,
            expression: parameter.expression,
          },
        },
      }),
    )
  }
  for (const source of plan.sketches) {
    const authored = authorPreparedPlanarImport(f3dSketchData(source), {
      id: sketchIdSchema.parse(uuid()),
      label: source.name,
      plane: "xy",
      createEntityId: () => sketchEntityIdSchema.parse(uuid()),
    })
    sketches.set(source.record, authored)
    commands.push(
      insertSketchInHistoryCommandSchema.parse({
        ...envelope(),
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-sketch",
        payload: { sketch: authored.sketch, historyAfter },
      }),
    )
    historyAfter = { kind: "sketch", id: authored.sketch.id }
  }
  let editableFeature: ReturnType<typeof featureRecordSchema.parse> | null = null
  if (f3dCylinderMatches(plan, inspection) && plan.cylinder) {
    const authored = sketches.get(plan.cylinder.sketchRecord)
    const circle = authored?.sketch.entities.find((e) => e.type === "circle")
    if (authored && circle)
      editableFeature = featureRecordSchema.parse({
        schemaVersion: 0,
        id: uuid(),
        type: extrusionFeatureType.type,
        parameters: {
          profile: {
            schemaVersion: 0,
            sketchId: authored.sketch.id,
            outerBoundaryEntityIds: [circle.id],
            holeBoundaryEntityIds: [],
          },
          distance: createLengthQuantity(plan.cylinder.distance),
          symmetric: false,
          operation: "new",
        },
        dependencies: [],
        references: [],
        suppressed: false,
        label: plan.cylinder.name,
      })
  }
  return { commands, historyAfter, editableFeature }
}
