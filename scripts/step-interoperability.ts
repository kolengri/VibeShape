import { existsSync, readFileSync } from "node:fs"
import { delimiter, isAbsolute, join, resolve } from "node:path"
import { z } from "zod"
import { GEOMETRY_PROTOCOL_VERSION } from "../packages/protocol/src"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const finiteNumberSchema = z.number().finite()
const vector3Schema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])

const shapeMetricsSchema = z.strictObject({
  valid: z.boolean(),
  volume: finiteNumberSchema.positive(),
  surfaceArea: finiteNumberSchema.positive(),
  bounds: z.strictObject({ min: vector3Schema, max: vector3Schema }),
  faceCount: z.number().int().positive(),
  edgeCount: z.number().int().positive(),
  solidCount: z.number().int().positive(),
})

export const stepProducerReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocolVersion: z.literal(GEOMETRY_PROTOCOL_VERSION),
  producer: z.strictObject({
    adapter: z.literal("replicad"),
    adapterVersion: z.literal("spike-controlled-1"),
    replicadVersion: z.literal("0.23.1"),
    opencascadePackageVersion: z.literal(
      `controlled-${OCCT_BUILD_INPUTS.sources.occt.revision.slice(0, 12)}`,
    ),
    opencascadeSourceRevision: z.literal(OCCT_BUILD_INPUTS.sources.occt.revision),
    wasmBytes: z.number().int().positive(),
    initializedInMs: finiteNumberSchema.nonnegative(),
  }),
  shape: shapeMetricsSchema.extend({ valid: z.literal(true), solidCount: z.literal(1) }),
  step: z.strictObject({
    file: z.literal("vibeshape-kernel-fixture.step"),
    bytes: z.number().int().positive(),
    sha256: digestSchema,
  }),
})

export const stepInteroperabilityReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reader: z.strictObject({
    name: z.literal("FreeCAD"),
    version: z.string().min(1),
    implementation: z.literal("Part.Shape.read"),
  }),
  input: z.strictObject({
    file: z.literal("vibeshape-kernel-fixture.step"),
    bytes: z.number().int().positive(),
    sha256: digestSchema,
  }),
  shape: shapeMetricsSchema.extend({
    valid: z.literal(true),
    solidCount: z.literal(1),
    shapeType: z.literal("Solid"),
  }),
  comparison: z.strictObject({
    relativeVolumeError: finiteNumberSchema.nonnegative().max(1e-8),
    maxBoundsDeltaMm: finiteNumberSchema.nonnegative().max(1e-5),
  }),
  tolerances: z.strictObject({
    maximumRelativeVolumeError: z.literal(1e-8),
    maximumBoundsDeltaMm: z.literal(1e-5),
  }),
  passed: z.literal(true),
})

const macOsFreeCadCommands = [
  "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd",
  "/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd",
  "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd",
] as const

export function assertLocalStepInteroperabilityEnvironment(
  environment: Record<string, string | undefined>,
) {
  if (environment.CI) {
    throw new Error("Independent STEP evidence is local-only and must not run in CI.")
  }
}

function commandCandidates(environment: Record<string, string | undefined>) {
  const pathDirectories = (environment.PATH ?? "").split(delimiter).filter(Boolean)
  const pathCommands = pathDirectories.flatMap((directory) => [
    join(directory, "FreeCADCmd"),
    join(directory, "freecadcmd"),
  ])
  const override = environment.VIBESHAPE_FREECAD_CMD?.trim()
  const overrideCandidates = override
    ? isAbsolute(override) || override.includes("/")
      ? [resolve(override)]
      : pathDirectories.map((directory) => join(directory, override))
    : []

  return Array.from(new Set([...overrideCandidates, ...pathCommands, ...macOsFreeCadCommands]))
}

export function resolveFreeCadCommand(
  environment: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = existsSync,
) {
  const command = commandCandidates(environment).find(fileExists)

  if (!command) {
    throw new Error(
      "FreeCADCmd was not found. Install FreeCAD locally or set VIBESHAPE_FREECAD_CMD to its headless executable.",
    )
  }

  return command
}

export function readStepProducerReport(path: string) {
  return stepProducerReportSchema.parse(JSON.parse(readFileSync(path, "utf8")))
}

export function readStepInteroperabilityReport(path: string) {
  return stepInteroperabilityReportSchema.parse(JSON.parse(readFileSync(path, "utf8")))
}
