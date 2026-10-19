import {
  type AssemblyInspectionView,
  type AssemblyOperation,
  assemblyInspectionViewSchema,
  assemblyMotionSamplesViewSchema,
} from "@vibeshape/automation-api/assembly-tools"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import {
  type AssemblyAuthority,
  type AssemblyMotionStudy,
  assemblyMotionStudyChanges,
  assemblyMotionTimes,
} from "@vibeshape/domain/assembly-authority"
import { rotateAssemblyVector } from "@vibeshape/domain/assembly-poses"
import type { z } from "zod"
import type { AssemblyResult, AssemblySessionConfiguration } from "./assembly-session-contract"

type Input = Extract<AssemblyOperation, { tool: "sample_assembly_motion_study" }>["arguments"]
type Sample = z.infer<typeof assemblyMotionSamplesViewSchema>["samples"][number]

function motionSample(
  inspection: AssemblyInspectionView,
  input: Input,
  timeSeconds: number,
): AssemblyResult<Sample> {
  const occurrences = inspection.occurrences
    .filter(({ instanceId }) => input.instanceIds.includes(instanceId))
    .map(({ instanceId, sourceIndex, geometryFrame }) => ({
      instanceId,
      sourceIndex,
      geometryFrame,
    }))
  if (input.instanceIds.some((id) => !occurrences.some(({ instanceId }) => instanceId === id)))
    return localFailure(
      "invalid-assembly-preview",
      "A requested occurrence is missing from the solved motion sample.",
    )
  if (!input.trace) return { ok: true, value: { timeSeconds, occurrences } }
  const trace = input.trace,
    target = occurrences.find(
      ({ instanceId, sourceIndex }) =>
        instanceId === trace.instanceId && sourceIndex === trace.sourceIndex,
    )
  if (!target)
    return localFailure(
      "assembly-operation-failed",
      "The traced occurrence/source is missing from a solved sample.",
    )
  const rotated = rotateAssemblyVector(trace.point, target.geometryFrame.quaternion)
  return {
    ok: true,
    value: {
      timeSeconds,
      occurrences,
      tracePointMm: [
        rotated[0] + target.geometryFrame.translation[0],
        rotated[1] + target.geometryFrame.translation[1],
        rotated[2] + target.geometryFrame.translation[2],
      ],
    },
  }
}

/** The caller owns one serialized request; all sample evidence must retain its captured authority. */
export async function sampleAssemblyMotion({
  configuration,
  authority,
  study,
  input,
  current,
}: {
  configuration: AssemblySessionConfiguration
  authority: { id: string; assembly: AssemblyAuthority }
  study: AssemblyMotionStudy
  input: Input
  current: () => LocalFailure | null
}): Promise<AssemblyResult<z.infer<typeof assemblyMotionSamplesViewSchema>>> {
  const samples: Sample[] = []
  for (const timeSeconds of assemblyMotionTimes(study.duration, input.sampleCount, input.reverse)) {
    const interrupted = current()
    if (interrupted) return interrupted
    const solved = await configuration.preview(
      assemblyMotionStudyChanges(study, authority.assembly.joints, timeSeconds),
      input.revision,
      [],
    )
    const late = current()
    if (late) return late
    if (!solved.ok) return solved
    const inspection = assemblyInspectionViewSchema.parse(solved.value)
    if (inspection.documentId !== authority.id || inspection.revision !== input.revision)
      return localFailure(
        "invalid-assembly-preview",
        "Exact motion evidence belongs to a different document revision.",
      )
    const sample = motionSample(inspection, input, timeSeconds)
    if (!sample.ok) return sample
    samples.push(sample.value)
    if (serializedQueryBytes(samples) > 120 * 1024)
      return localFailure(
        "query-result-too-large",
        "The motion samples exceed the response budget; choose fewer samples or occurrences.",
      )
  }
  return {
    ok: true,
    value: assemblyMotionSamplesViewSchema.parse({
      schemaVersion: 1,
      documentId: authority.id,
      revision: input.revision,
      studyId: study.id,
      samples,
    }),
  }
}
