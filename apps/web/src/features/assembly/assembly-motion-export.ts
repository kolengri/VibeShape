import type { AssemblyVector3 } from "@vibeshape/domain/assembly"
import type { AssemblyMotionStudy } from "@vibeshape/domain/assembly-authority"
import { rotateAssemblyVector } from "@vibeshape/domain/assembly-poses"
import type { AssemblyInspection } from "@vibeshape/protocol"
import type { ModelPreviewOptions } from "@vibeshape/viewer/model-preview"
import { strToU8 } from "fflate"
import { z } from "zod"
import { archiveAssemblyMotionFrames } from "./assembly-motion-archive"

export type AssemblyMotionSolvedSample = { value: number; inspection: AssemblyInspection }
export type AssemblyMotionTrace = {
  instanceId: string
  sourceIndex: number
  point: AssemblyVector3
}
class AssemblyMotionExportFailure extends Error {
  constructor(readonly code: "samples" | "trace" | "frames") {
    super(`Motion export failed: ${code}.`)
  }
}
export function assemblyMotionTraceInput(
  raw: string,
  target: string,
  inspection?: AssemblyInspection,
): AssemblyMotionTrace | undefined {
  if (!target) return undefined
  const occurrence = inspection?.occurrences.find(
    ({ instanceId, sourceIndex }) => `${instanceId}:${sourceIndex}` === target,
  )
  if (!occurrence) throw new AssemblyMotionExportFailure("trace")
  return {
    instanceId: occurrence.instanceId,
    sourceIndex: occurrence.sourceIndex,
    point: motionPoint(raw),
  }
}
const traceCoordinate = z.number().finite().min(-100000).max(100000)
const tracePointSchema = z.tuple([traceCoordinate, traceCoordinate, traceCoordinate])
function motionPoint(raw: string) {
  const tokens = raw.split(",")
  if (tokens.some((value) => !value.trim())) throw new AssemblyMotionExportFailure("trace")
  const parsed = tracePointSchema.safeParse(tokens.map(Number))
  if (!parsed.success) throw new AssemblyMotionExportFailure("trace")
  return parsed.data
}
export function assemblyMotionExportFailureKey(failure: unknown) {
  if (!(failure instanceof AssemblyMotionExportFailure)) return "motionExportUnavailable" as const
  if (failure.code === "trace") return "motionTraceInvalid" as const
  if (failure.code === "frames") return "motionPngLimit" as const
  return "motionExportUnavailable" as const
}

export function assemblyMotionExportData(
  study: AssemblyMotionStudy,
  revision: number,
  samples: readonly AssemblyMotionSolvedSample[],
  trace?: AssemblyMotionTrace,
) {
  if (!samples.length || samples.length > 256 || !Number.isSafeInteger(revision) || revision < 0)
    throw new AssemblyMotionExportFailure("samples")
  if (trace?.point.some((value) => !Number.isFinite(value) || Math.abs(value) > 100000))
    throw new AssemblyMotionExportFailure("trace")
  const poses = samples.map(({ value, inspection }) => {
    if (!Number.isFinite(value) || value < 0 || value > study.duration)
      throw new AssemblyMotionExportFailure("samples")
    const occurrences = inspection.occurrences.map(
      ({ instanceId, sourceIndex, geometryFrame }) => ({ instanceId, sourceIndex, geometryFrame }),
    )
    let point: [number, number, number] | undefined
    if (trace) {
      const occurrence = occurrences.find(
        ({ instanceId, sourceIndex }) =>
          instanceId === trace.instanceId && sourceIndex === trace.sourceIndex,
      )
      if (!occurrence) throw new AssemblyMotionExportFailure("trace")
      const rotated = rotateAssemblyVector(trace.point, occurrence.geometryFrame.quaternion)
      point = [
        rotated[0] + occurrence.geometryFrame.translation[0],
        rotated[1] + occurrence.geometryFrame.translation[1],
        rotated[2] + occurrence.geometryFrame.translation[2],
      ]
    }
    return { timeSeconds: value, occurrences, ...(point ? { tracePointMm: point } : {}) }
  })
  return {
    schemaVersion: 1 as const,
    studyId: study.id,
    studyName: study.name,
    revision,
    units: { translation: "mm", angle: "rad", time: "s", quaternion: "xyzw" },
    ...(trace ? { trace } : {}),
    samples: poses,
  }
}

export function assemblyMotionCsv(data: ReturnType<typeof assemblyMotionExportData>) {
  const rows = [
    "study_id,revision,time_s,instance_id,source_index,x_mm,y_mm,z_mm,qx,qy,qz,qw,trace_x_mm,trace_y_mm,trace_z_mm",
  ]
  for (const sample of data.samples)
    for (const occurrence of sample.occurrences) {
      const point =
        data.trace?.instanceId === occurrence.instanceId &&
        data.trace.sourceIndex === occurrence.sourceIndex
          ? sample.tracePointMm
          : undefined
      rows.push(
        [
          data.studyId,
          data.revision,
          sample.timeSeconds,
          occurrence.instanceId,
          occurrence.sourceIndex,
          ...occurrence.geometryFrame.translation,
          ...occurrence.geometryFrame.quaternion,
          ...(point ?? ["", "", ""]),
        ].join(","),
      )
    }
  return `${rows.join("\n")}\n`
}

function sequenceCamera(samples: readonly AssemblyMotionSolvedSample[]): ModelPreviewOptions {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let found = false
  for (const { inspection } of samples)
    for (const { bounds } of inspection.occurrences) {
      found = true
      for (const axis of [0, 1, 2] as const) {
        min[axis] = Math.min(min[axis], bounds.min[axis])
        max[axis] = Math.max(max[axis], bounds.max[axis])
      }
    }
  if (!found) throw new AssemblyMotionExportFailure("samples")
  const target: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ]
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]))
  return {
    camera: {
      target,
      position: [target[0] + radius, target[1] + radius, target[2] + radius],
      up: [0, 0, 1],
      viewHeightMm: radius * 1.2,
    },
  }
}

/** Reuse the existing bounded snapshot renderer; fixed camera prevents per-frame auto-fit jumps. */
export async function assemblyMotionPngSequence(
  data: ReturnType<typeof assemblyMotionExportData>,
  samples: readonly AssemblyMotionSolvedSample[],
  signal: AbortSignal,
) {
  if (samples.length !== data.samples.length || samples.length > 64)
    throw new AssemblyMotionExportFailure("frames")
  const { renderModelPreview } = await import("@vibeshape/viewer/model-preview")
  const camera = sequenceCamera(samples)
  const files: Record<string, Uint8Array> = {
    "motion.json": strToU8(JSON.stringify(data, null, 2)),
  }
  for (const [index, sample] of samples.entries()) {
    signal.throwIfAborted()
    const image = await renderModelPreview(
      sample.inspection.occurrences.map(({ instanceId, sourceIndex, mesh }) => ({
        ...mesh,
        featureId: instanceId,
        outputRole: `assembly-source-${sourceIndex}`,
      })),
      camera,
    )
    signal.throwIfAborted()
    files[`frame-${String(index + 1).padStart(4, "0")}.png`] = Uint8Array.from(
      atob(image.base64),
      (value) => value.charCodeAt(0),
    )
  }
  signal.throwIfAborted()
  return archiveAssemblyMotionFrames(files, signal)
}
export function prepareAssemblyMotionExport(
  format: "json" | "csv" | "zip",
  data: ReturnType<typeof assemblyMotionExportData>,
  samples: readonly AssemblyMotionSolvedSample[],
  signal: AbortSignal,
) {
  if (format === "json") return JSON.stringify(data, null, 2)
  if (format === "csv") return assemblyMotionCsv(data)
  return assemblyMotionPngSequence(data, samples, signal)
}

export function downloadAssemblyMotion(name: string, suffix: string, content: string | Uint8Array) {
  const blob = new Blob([typeof content === "string" ? content : new Uint8Array(content)], {
    type: suffix === "zip" ? "application/zip" : suffix === "csv" ? "text/csv" : "application/json",
  })
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "motion"}.${suffix}`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
