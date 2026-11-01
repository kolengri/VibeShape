import {
  preparedPlanarCurveSchema,
  preparedPlanarImportSchema,
} from "@vibeshape/domain/planar-import-authoring"
import { evaluateExpression } from "@vibeshape/domain/variables"
import { z } from "zod"
import { unzip } from "./archive"
import { bodiesStep } from "./brep-step"
import { F3dFormatError } from "./bytes"
import { type F3dDesign, type F3dSketchFeature, IDENTITY, readF3dEntries } from "./model"

export { F3dFormatError } from "./bytes"
export const MAX_F3D_BYTES = 64 * 1024 * 1024
const MAX_STEP_BYTES = 128 * 1024 * 1024
const issue = z.object({ name: z.string().max(256), reason: z.string().max(4096) }).strict()
export const f3dReportSchema = z
  .object({
    sourceFeatures: z.number().int().nonnegative(),
    recoveredBodies: z.number().int().nonnegative().max(128),
    editableSketches: z.number().int().nonnegative().max(128),
    numericParameters: z.number().int().nonnegative().max(100),
    unsupported: z.array(issue).max(4096),
  })
  .strict()
export const f3dPreparationSchema = z
  .object({
    step: z.string().min(1).max(MAX_STEP_BYTES),
    sketches: z
      .array(
        z
          .object({
            record: z.number().int().nonnegative(),
            name: z.string().min(1).max(120),
            curves: z.array(preparedPlanarCurveSchema).min(1).max(1662),
          })
          .strict(),
      )
      .max(128),
    parameters: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            expression: z.string().min(1).max(256),
          })
          .strict(),
      )
      .max(100),
    cylinder: z
      .object({
        sketchRecord: z.number().int().nonnegative(),
        name: z.string().min(1).max(120),
        x: z.number().finite(),
        y: z.number().finite(),
        radius: z.number().positive().finite(),
        distance: z.number().min(0.001).max(100000),
      })
      .strict()
      .nullable(),
    report: f3dReportSchema,
  })
  .strict()
export type F3dPreparation = z.infer<typeof f3dPreparationSchema>
export type F3dReport = z.infer<typeof f3dReportSchema>

const label = (value: string) => value.trim().slice(0, 120) || "F3D record"
const near = (a: number, b: number) => Math.abs(a - b) < 1e-8
type Curve = z.infer<typeof preparedPlanarCurveSchema>
type Issue = F3dReport["unsupported"][number]

/** Reuses native planar validation before reporting an editable sketch. */
export function f3dSketchData(
  sketch: Pick<F3dPreparation["sketches"][number], "record" | "curves">,
) {
  return preparedPlanarImportSchema.parse({
    schemaVersion: 0,
    format: "dxf",
    units: { coordinateUnit: "mm", sourceUnit: "cm", millimetersPerUnit: 10, policy: "declared" },
    paths: sketch.curves.map((curve, ordinal) => ({
      sourceOrdinal: ordinal,
      inspectionId: `f3d.${sketch.record}.${ordinal}`,
      closed: curve.type === "circle",
      segments: [{ sourceOrdinal: 0, sourceDirection: 1, curve }],
    })),
  })
}
function lineCurve(line: F3dSketchFeature["sketch"]["lines"][number]): Curve {
  if (line.construction) throw new F3dFormatError("Construction geometry is not mapped.")
  if (!near(line.start[2], 0) || !near(line.end[2], 0))
    throw new F3dFormatError("Nonplanar sketch geometry is not mapped.")
  return {
    type: "line",
    start: [line.start[0] * 10, line.start[1] * 10],
    end: [line.end[0] * 10, line.end[1] * 10],
  }
}
function circleCurve(circle: F3dSketchFeature["sketch"]["circulars"][number]): Curve {
  const planarCircle = near(circle.center[2], 0) && near(Math.abs(circle.normal[2]), 1)
  if (
    circle.construction ||
    !planarCircle ||
    !near(Math.abs(circle.endAngle - circle.startAngle), 2 * Math.PI)
  )
    throw new F3dFormatError("Only full nonconstruction planar circles are mapped.")
  return {
    type: "circle",
    center: [circle.center[0] * 10, circle.center[1] * 10],
    radius: circle.radius * 10,
  }
}
function sketchCurves(feature: F3dSketchFeature) {
  const sketch = feature.sketch
  if (sketch.frame.length !== 16 || !sketch.frame.every((v, i) => near(v, IDENTITY[i] ?? 0)))
    throw new F3dFormatError("Only sketches on the untransformed XY origin plane are editable.")
  if (sketch.splines.length || sketch.texts.length || sketch.ellipses?.length)
    throw new F3dFormatError("Splines, text and ellipses are retained only in recovered bodies.")
  const curves = [...sketch.lines.map(lineCurve), ...sketch.circulars.map(circleCurve)]
  if (!curves.length) throw new F3dFormatError("The sketch has no supported curves.")
  f3dSketchData({ record: sketch.id, curves })
  return curves
}
function parameterExpression(parameter: F3dDesign["userParameters"][number]) {
  if (!Number.isFinite(parameter.value))
    throw new F3dFormatError("A parameter has a non-finite value.")
  if (parameter.text !== undefined) return null
  const unit = parameter.unit.toLowerCase()
  if (["mm", "cm", "m", "in", "inch", "ft", "um"].includes(unit))
    return `${parameter.value * 10} mm`
  if (["deg", "rad"].includes(unit)) return `${parameter.value} rad`
  return unit === "" ? String(parameter.value) : null
}
function mapParameters(design: F3dDesign, unsupported: Issue[]) {
  const parameters: F3dPreparation["parameters"] = []
  for (const parameter of design.userParameters) {
    const expression = parameterExpression(parameter)
    if (expression && evaluateExpression(expression, new Map()).ok && parameters.length < 100)
      parameters.push({ name: label(parameter.name), expression })
    else
      unsupported.push({
        name: label(parameter.name),
        reason: "This parameter type or parameter count is unsupported.",
      })
  }
  if (parameters.length)
    unsupported.push({
      name: "Parameter expressions",
      reason:
        "Numeric user parameters are copied as independent editable constants. Fusion expressions and feature links are not preserved.",
    })
  return parameters
}
function hasSketchConstraints(feature: F3dSketchFeature) {
  return Boolean(feature.sketch.relations?.length || feature.sketch.dimensions?.length)
}
function mapSketchFeature(
  feature: F3dSketchFeature,
  sketches: F3dPreparation["sketches"],
  unsupported: Issue[],
) {
  try {
    if (sketches.length >= 128) throw new F3dFormatError("The editable sketch count limit is 128.")
    sketches.push({
      record: feature.sketch.id,
      name: label(feature.name),
      curves: sketchCurves(feature),
    })
    if (hasSketchConstraints(feature))
      unsupported.push({
        name: label(feature.name),
        reason:
          "Sketch geometry is editable; Fusion constraints and dimensions are not transferred.",
      })
  } catch (error) {
    unsupported.push({
      name: label(feature.name),
      reason: error instanceof Error ? error.message.slice(0, 4096) : "Unsupported sketch.",
    })
  }
}
function mapSketches(design: F3dDesign, unsupported: Issue[]) {
  const sketches: F3dPreparation["sketches"] = []
  for (const feature of design.features) {
    if (feature.type !== "sketch" || feature.suppressed) continue
    mapSketchFeature(feature, sketches, unsupported)
  }
  return sketches
}
function canPromoteDesign(design: F3dDesign, recoveredBodies: number) {
  if (recoveredBodies !== 1 || design.problems.length || design.unreadParameters) return false
  return (
    (design.components?.length ?? 1) <= 1 &&
    design.features.filter((f) => !f.suppressed).length === 2
  )
}
function simpleExtrudeProfile(
  feature: Extract<F3dDesign["features"][number], { type: "extrude" }>,
) {
  if (!feature.solid || feature.start !== "profile-plane" || feature.sketchGone) return false
  return feature.faces.length === 0 && feature.participants.length === 0
}
function simpleExtrude(feature: F3dDesign["features"][number] | undefined) {
  if (feature?.type !== "extrude") return null
  if (feature.operation !== "new-body" || feature.direction !== "one-side" || feature.reversed)
    return null
  return simpleExtrudeProfile(feature) ? feature : null
}
function cylinderDistance(feature: NonNullable<ReturnType<typeof simpleExtrude>>) {
  if (
    !feature.parameters.every(
      (p) => p.kind === "AlongDistance" || (p.kind === "TaperAngle" && near(p.value, 0)),
    )
  )
    return null
  const distance = feature.parameters.find((p) => p.kind === "AlongDistance")?.value
  if (distance === undefined || distance < 0.0001 || distance > 10000) return null
  return distance * 10
}
function singleCircleProfile(
  sketches: F3dPreparation["sketches"],
  feature: NonNullable<ReturnType<typeof simpleExtrude>>,
) {
  const sketch = sketches[0]
  if (sketch?.curves.length !== 1 || feature.profiles.length !== 1) return null
  const curve = sketch.curves[0]
  if (curve?.type !== "circle" || feature.profiles[0]?.sketch !== sketch.record) return null
  return { sketch, curve }
}
function cylinderCandidate(
  design: F3dDesign,
  sketches: F3dPreparation["sketches"],
  bodies: number,
): F3dPreparation["cylinder"] {
  if (!canPromoteDesign(design, bodies)) return null
  const feature = simpleExtrude(design.features.find((f) => f.type === "extrude"))
  if (!feature || sketches.length !== 1) return null
  const selected = singleCircleProfile(sketches, feature)
  if (!selected) return null
  const { sketch, curve } = selected
  const distance = cylinderDistance(feature)
  return distance === null
    ? null
    : {
        sketchRecord: sketch.record,
        name: label(feature.name),
        x: curve.center[0],
        y: curve.center[1],
        radius: curve.radius,
        distance,
      }
}
function unsupportedFeature(
  feature: F3dDesign["features"][number],
  cylinder: F3dPreparation["cylinder"],
): Issue | null {
  if (feature.type === "sketch") return null
  const reason = feature.suppressed
    ? "Suppressed source feature is not transferred."
    : cylinder && feature.type === "extrude"
      ? "Circular extrusion is editable only when source-body measurements confirm the decoded extent; otherwise its exact body is retained."
      : `${feature.kind} is retained as an exact body where B-rep recovery succeeds; its feature history is unsupported.`
  return { name: label(feature.name), reason }
}

/** Maps decoded values, never Fusion expression code or transient topology indices. */
export function mapF3dDesign(
  design: F3dDesign,
  step: string,
  recoveredBodies: number,
): F3dPreparation {
  const unsupported: Issue[] = design.problems.map((reason) => ({
    name: "Design record",
    reason: reason.slice(0, 4096),
  }))
  const parameters = mapParameters(design, unsupported)
  const sketches = mapSketches(design, unsupported)
  const cylinder = cylinderCandidate(design, sketches, recoveredBodies)
  for (const feature of design.features) {
    const issue = unsupportedFeature(feature, cylinder)
    if (issue) unsupported.push(issue)
  }
  return f3dPreparationSchema.parse({
    step,
    sketches,
    parameters,
    cylinder,
    report: {
      sourceFeatures: design.features.length,
      recoveredBodies,
      editableSketches: sketches.length,
      numericParameters: parameters.length,
      unsupported,
    },
  })
}

/** The writer emits trusted STEP syntax; only generated entity IDs are rebased. */
function combineSteps(steps: string[]) {
  const first = steps[0]
  if (!first)
    throw new F3dFormatError(
      "No supported visible solid bodies could be recovered from this F3D archive.",
    )
  let offset = 0
  const data: string[] = []
  let length = 0
  for (const step of steps) {
    const body = /\bDATA;([\s\S]*?)ENDSEC;/.exec(step)?.[1]
    if (!body) throw new F3dFormatError("The recovered STEP body is invalid.")
    let largest = 0
    const shifted = body.replace(/#(\d+)/g, (_, value: string) => {
      const n = Number(value)
      largest = Math.max(largest, n)
      return `#${n + offset}`
    })
    offset += largest
    length += shifted.length
    if (length > MAX_STEP_BYTES)
      throw new F3dFormatError("Recovered STEP data exceeds its 128 MiB budget.")
    data.push(shifted)
  }
  return `${first.slice(0, first.indexOf("DATA;"))}DATA;\n${data.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`
}

/** Read-only, bounded worker preparation; exact geometry is validated separately by OCCT. */
export function prepareF3dImport(bytes: Uint8Array): F3dPreparation {
  if (bytes.byteLength > MAX_F3D_BYTES)
    throw new F3dFormatError("F3D source exceeds its 64 MiB budget.")
  const entries = unzip(bytes)
  const design = readF3dEntries(entries)
  if ((design.components?.length ?? 0) > 1 || design.bodyMoves?.length)
    throw new F3dFormatError(
      "F3D component occurrences and body moves are unsupported. Export a placed STEP assembly from the source application.",
    )
  const bodies = bodiesStep(entries, design)
  const supported = bodies.filter((body) => body.step !== undefined)
  if (supported.length > 128) throw new F3dFormatError("F3D source exceeds the 128-body budget.")
  const step = combineSteps(supported.map((body) => body.step as string))
  const plan = mapF3dDesign(design, step, supported.length)
  for (const body of bodies)
    if (body.reason)
      plan.report.unsupported.push({ name: label(body.name), reason: body.reason.slice(0, 4096) })
  return f3dPreparationSchema.parse(plan)
}
