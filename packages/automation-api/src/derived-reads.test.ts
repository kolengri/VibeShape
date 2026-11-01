import { expect, it } from "bun:test"
import { BINARY_EXPORT_CHUNK_MAX_BYTES, binaryExportDescriptorSchema } from "./binary-exports"
import {
  derivedReadResultContextMatches,
  inspectMotionClearanceArgumentsSchema,
  motionClearanceReportSchema,
  preparePictureRenderArgumentsSchema,
} from "./derived-reads"
import {
  localOperationSchema,
  localToolNameSchema,
  localToolOutputs,
  mcpToolInputJsonSchema,
  parseMcpToolCall,
} from "./local-tools"
import { remoteOperationSchema } from "./remote-session"
import { localToolAnnotations, localToolDescriptions } from "./tool-metadata"

const id = (n: number) => `01950000-0000-7000-8000-${String(n).padStart(12, "0")}`
const actor = { type: "mcp", clientId: "org.example.test", sessionId: id(2) }
const input = {
  revision: 7,
  jointId: id(4),
  coordinate: "translation",
  start: -2,
  end: 2,
  sampleCount: 3,
  minimumGap: 0.4,
}
const measured = {
  leftInstanceId: id(5),
  rightInstanceId: id(6),
  distance: 0.3,
  volume: 0,
  solidCount: 0,
  violatesMinimumGap: true,
}
function report() {
  return {
    status: "complete",
    scope: { documentId: id(1), revision: 7, actor, sourceDigest: "a".repeat(64) },
    ...input,
    requestedSamples: 3,
    sampleCount: undefined,
    resolution: 2,
    pairs: [{ leftInstanceId: id(5), rightInstanceId: id(6) }],
    samples: [-2, 0, 2].map((value) => ({
      value,
      poseDigest: "a".repeat(64),
      smallest: measured,
      collisionCount: 0,
      belowGapCount: 1,
    })),
    smallest: { value: -2, ...measured },
    coverage: "sampled-poses-only",
  }
}
function validReport() {
  const { sampleCount: _sampleCount, revision: _revision, ...value } = report()
  return value
}
it("advertises identical bounded derived reads locally and remotely with explicit project targeting", () => {
  for (const [tool, args] of [
    ["prepare_picture_render", { revision: 7 }],
    ["inspect_motion_clearance", input],
  ] as const) {
    const operation = { tool, arguments: args, projectId: id(1) }
    expect(localToolNameSchema.options).toContain(tool)
    expect(remoteOperationSchema.parse(operation)).toEqual<unknown>(
      localOperationSchema.parse(operation),
    )
    expect(parseMcpToolCall(tool, { ...args, projectId: id(1) }).success).toBe(true)
    expect(mcpToolInputJsonSchema(tool).properties).toHaveProperty("projectId")
    expect(localToolAnnotations(tool).readOnlyHint).toBe(true)
    expect(localToolDescriptions[tool].length).toBeGreaterThan(100)
  }
  expect(
    localOperationSchema.safeParse({
      tool: "prepare_model_export",
      arguments: { revision: 7, format: "png" },
    }).success,
  ).toBe(false)
  expect(
    localOperationSchema.safeParse({
      tool: "export_model",
      arguments: { revision: 7, format: "png" },
    }).success,
  ).toBe(false)
})
it("rejects hostile picture settings, ambient cameras and writable arguments", () => {
  for (const args of [
    { revision: 7, path: "/tmp/a.png" },
    { revision: 7, settings: { width: 1920, height: 1920 } },
    { revision: 7, settings: { camera: "current" } },
    { revision: 7, camera: { position: [1, 0, 0], target: [0, 0, 0] } },
    { revision: 7, settings: { quality: "ultra" } },
    { revision: 7, settings: { width: Infinity } },
    {
      revision: 7,
      settings: {
        finishes: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i), "wood"])),
      },
    },
    {
      revision: 7,
      settings: { camera: "current" },
      camera: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 0, 1] },
    },
  ])
    expect(preparePictureRenderArgumentsSchema.safeParse(args).success).toBe(false)
})
it("validates PNG descriptor types, settings and document/revision provenance", () => {
  const args = preparePictureRenderArgumentsSchema.parse({ revision: 7 })
  const file = {
    exportId: id(3),
    documentId: id(1),
    revision: 7,
    format: "png",
    filename: "model.png",
    mimeType: "image/png",
    byteLength: 8,
    sha256: "a".repeat(64),
    expiresAt: "2026-11-01T12:00:00Z",
    chunkMaxBytes: BINARY_EXPORT_CHUNK_MAX_BYTES,
  }
  const operation = { tool: "prepare_picture_render", arguments: args }
  const result = {
    ok: true,
    value: { file, settings: args.settings, sourceDigest: "b".repeat(64) },
  }
  expect(localToolOutputs.prepare_picture_render.safeParse(result).success).toBe(true)
  expect(derivedReadResultContextMatches(operation, result, id(1))).toBe(true)
  for (const changed of [
    { documentId: id(8) },
    { revision: 6 },
    { mimeType: "model/stl" },
    { byteLength: 6 * 1024 * 1024 + 1 },
  ])
    expect(
      derivedReadResultContextMatches(
        operation,
        { ok: true, value: { ...result.value, file: { ...file, ...changed } } },
        id(1),
      ),
    ).toBe(false)
  expect(binaryExportDescriptorSchema.safeParse({ ...file, filename: "model.stl" }).success).toBe(
    false,
  )
  expect(
    derivedReadResultContextMatches(
      operation,
      { ok: true, value: { ...result.value, settings: { ...args.settings, quality: "high" } } },
      id(1),
    ),
  ).toBe(false)
})
it("rejects clearance provenance, range, sampling, threshold and minimum mismatches", () => {
  const value = validReport(),
    operation = { tool: "inspect_motion_clearance", arguments: input }
  expect(motionClearanceReportSchema.safeParse(value).success).toBe(true)
  expect(derivedReadResultContextMatches(operation, { ok: true, value }, id(1), actor)).toBe(true)
  for (const changed of [
    { jointId: id(9) },
    { start: -3 },
    { end: 3 },
    { requestedSamples: 4 },
    { minimumGap: 0.2 },
    { scope: { ...value.scope, documentId: id(9) } },
    { scope: { ...value.scope, revision: 8 } },
    { scope: { ...value.scope, actor: { ...actor, sessionId: id(9) } } },
    { samples: value.samples.slice(1) },
    { smallest: { ...value.smallest, distance: 5 } },
  ])
    expect(
      derivedReadResultContextMatches(
        operation,
        { ok: true, value: { ...value, ...changed } },
        id(1),
        actor,
      ),
    ).toBe(false)
  for (const args of [
    { ...input, sampleCount: 65 },
    { ...input, start: input.end },
    { ...input, actor },
    { ...input, minimumGap: -1 },
    { ...input, pairs: [{ leftInstanceId: id(5), rightInstanceId: id(5) }] },
  ])
    expect(
      remoteOperationSchema.safeParse({ tool: "inspect_motion_clearance", arguments: args })
        .success,
    ).toBe(false)
})

it("preserves an omitted motion-clearance threshold for bound authored tolerance resolution", () => {
  const { minimumGap: _minimumGap, ...args } = input
  expect(inspectMotionClearanceArgumentsSchema.parse(args).minimumGap).toBeUndefined()
  expect(
    inspectMotionClearanceArgumentsSchema.parse({ ...args, minimumGap: 0.35 }).minimumGap,
  ).toBe(0.35)
})
