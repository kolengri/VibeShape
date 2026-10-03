import type { SketchEntityId, SketchRecord } from "@vibeshape/domain"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { sketchConstraintEntityIds } from "@vibeshape/domain/sketch-edit"
import {
  BUNDLED_SKETCH_TEXT_FONT,
  SKETCH_TEXT_LAYOUT_ENGINE,
  SKETCH_TEXT_OUTLINE_SDK,
  type SketchTextParameters,
  sketchTextParametersSchema,
} from "@vibeshape/domain/sketch-text"
import {
  applySketchTextOutline,
  sketchTextGroupGeometryContent,
} from "@vibeshape/domain/sketch-text-edit"
import type { SketchTextGroup } from "@vibeshape/domain/sketch-text-groups"
import type { SketchTextOutlineResult } from "@vibeshape/formats/text-outline"
import { z } from "zod"
import { createBrowserSketchEntityId } from "../../../document/document-controller"
import { hashSketchTextContent } from "./text-font"

export type SketchTextValues = {
  text: string
  height: string
  tracking: string
  originX: string
  originY: string
  horizontal: SketchTextParameters["alignment"]["horizontal"]
  vertical: SketchTextParameters["alignment"]["vertical"]
  kerning: boolean
  removeAttachedConstraints: boolean
}
export type TextValidationKey =
  | "invalidText"
  | "invalidHeight"
  | "invalidTracking"
  | "invalidOrigin"
  | "invalidAlignment"
export type TextFieldErrors = Partial<Record<keyof SketchTextValues, TextValidationKey>>
const originSchema = z.tuple([
  z.number().finite().min(-100_000).max(100_000),
  z.number().finite().min(-100_000).max(100_000),
])
function numeric(value: string) {
  return value.trim() ? Number(value) : NaN
}
const parameterErrorFields: Record<string, readonly [keyof SketchTextValues, TextValidationKey]> = {
  text: ["text", "invalidText"],
  heightMm: ["height", "invalidHeight"],
  trackingMm: ["tracking", "invalidTracking"],
  alignment: ["horizontal", "invalidAlignment"],
}
function parameterErrors(issues: readonly z.core.$ZodIssue[]): TextFieldErrors {
  const errors: TextFieldErrors = {}
  for (const issue of issues) {
    const field = parameterErrorFields[String(issue.path[0])]
    if (field) errors[field[0]] = field[1]
  }
  return errors
}
export function sketchTextValues(group?: SketchTextGroup): SketchTextValues {
  return {
    text: group?.parameters.text ?? "Text",
    height: String(group?.parameters.heightMm ?? 10),
    tracking: String(group?.parameters.trackingMm ?? 0),
    originX: String(group?.origin[0] ?? 0),
    originY: String(group?.origin[1] ?? 0),
    horizontal: group?.parameters.alignment.horizontal ?? "left",
    vertical: group?.parameters.alignment.vertical ?? "baseline",
    kerning: group?.parameters.kerning ?? true,
    removeAttachedConstraints: false,
  }
}
export function parseSketchTextValues(values: SketchTextValues) {
  const parameters = sketchTextParametersSchema.safeParse({
    schemaVersion: 0,
    text: values.text,
    font: BUNDLED_SKETCH_TEXT_FONT,
    layoutEngine: SKETCH_TEXT_LAYOUT_ENGINE,
    outlineSdk: SKETCH_TEXT_OUTLINE_SDK,
    heightMm: numeric(values.height),
    trackingMm: numeric(values.tracking),
    alignment: { horizontal: values.horizontal, vertical: values.vertical },
    kerning: values.kerning,
  })
  const origin = originSchema.safeParse([numeric(values.originX), numeric(values.originY)])
  const errors: TextFieldErrors = parameters.success ? {} : parameterErrors(parameters.error.issues)
  if (!origin.success)
    for (const issue of origin.error.issues)
      errors[issue.path[0] === 0 ? "originX" : "originY"] = "invalidOrigin"
  return parameters.success && origin.success
    ? { ok: true as const, parameters: parameters.data, origin: origin.data, errors }
    : { ok: false as const, errors }
}
export function attachedSketchTextConstraints(sketch: SketchRecord, group: SketchTextGroup) {
  const owned = new Set<string>([...group.curveIds, ...group.pointIds])
  return sketch.constraints.filter((constraint) =>
    sketchConstraintEntityIds(constraint).some((id) => owned.has(id)),
  )
}
export function sketchTextDraftUnchanged(captured: SketchRecord, current: SketchRecord | null) {
  return current !== null && canonicalJson(captured) === canonicalJson(current)
}
export async function sketchTextOutlineAltered(sketch: SketchRecord, group: SketchTextGroup) {
  return (
    (await hashSketchTextContent(sketchTextGroupGeometryContent(sketch, group))) !==
    group.outlineDigest
  )
}
type OutlineDiagnostic = Extract<SketchTextOutlineResult, { ok: false }>["diagnostics"][number]
export class SketchTextOutlineError extends Error {
  constructor(readonly diagnostic: OutlineDiagnostic) {
    super(diagnostic.message)
  }
}
export async function createSketchTextDraft(
  sketch: SketchRecord,
  options: {
    parameters: SketchTextParameters
    origin: readonly [number, number]
    fontBytes: Uint8Array
    groupId?: SketchEntityId
    removeAttachedConstraints: boolean
    createEntityId?: () => SketchEntityId
  },
) {
  const { prepareSketchTextOutline } = await import("@vibeshape/formats/text-outline")
  const outline = await prepareSketchTextOutline(options.parameters, options.fontBytes)
  if (!outline.ok) {
    const diagnostic = outline.diagnostics[0]
    if (!diagnostic) throw new Error("Text preparation requires a diagnostic.")
    throw new SketchTextOutlineError(diagnostic)
  }
  const createId = options.createEntityId ?? createBrowserSketchEntityId
  return applySketchTextOutline(sketch, {
    groupId: options.groupId ?? createId(),
    parameters: outline.outline.parameters,
    origin: options.origin,
    contours: outline.outline.contours,
    createEntityId: createId,
    hash: hashSketchTextContent,
    replace: options.groupId !== undefined,
    removeAttachedConstraints: options.removeAttachedConstraints,
  })
}
