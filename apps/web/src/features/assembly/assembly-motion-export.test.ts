import { describe, expect, it, mock } from "bun:test"
import { assemblyMotionStudySchema } from "@vibeshape/domain/assembly-authority"
import type { AssemblyInspection } from "@vibeshape/protocol"
import type { ModelPreviewOptions } from "@vibeshape/viewer/model-preview"
import { unzipSync } from "fflate"
import { vi } from "../../../../../tests/unit/support/bun-test"
import {
  assemblyMotionCsv,
  assemblyMotionExportData,
  assemblyMotionPngSequence,
} from "./assembly-motion-export"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const render = vi.fn().mockResolvedValue({
  base64: "iVBORw0KGgo=",
  mimeType: "image/png",
  width: 1,
  height: 1,
  views: ["custom"],
})
mock.module("@vibeshape/viewer/model-preview", () => ({ renderModelPreview: render }))
const study = assemblyMotionStudySchema.parse({
  schemaVersion: 1,
  id: id(1),
  name: "Trace study",
  duration: 2,
  tracks: [
    {
      id: id(2),
      jointId: id(3),
      coordinate: "angle",
      keys: [
        { time: 0, value: 0 },
        { time: 2, value: 1 },
      ],
    },
  ],
})
function inspection(x: number): AssemblyInspection {
  return {
    interference: [],
    occurrences: [
      {
        instanceId: id(4),
        definitionId: id(5),
        pinRevision: 1,
        sourceIndex: 0,
        selectedBody: { schemaVersion: 0, featureId: id(6), outputRole: "result" },
        contentHash: "a".repeat(64),
        representation: "exact-solid",
        geometryFrame: { translation: [x, 2, 3], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
        bounds: { min: [x, 0, 0], max: [x + 10, 10, 10] },
        mesh: {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          triangleFaceIds: new Uint32Array([1]),
        },
      },
    ],
  }
}
describe("solved assembly motion exports", () => {
  it("fits a fixed camera at the full 64-frame and 4096-occurrence budget without rendering images", async () => {
    render.mockClear()
    const first = inspection(-10).occurrences[0]
    if (!first) throw new Error("The camera fixture requires one occurrence.")
    const occurrences = Array.from({ length: 4096 }, (_, index) => ({
      ...first,
      instanceId: id(100 + Math.floor(index / 16)),
      sourceIndex: index % 16,
      bounds:
        index === 0
          ? {
              min: [-10, -20, -30] as [number, number, number],
              max: [100, 200, 300] as [number, number, number],
            }
          : first.bounds,
    }))
    const samples = Array.from({ length: 64 }, (_, index) => ({
      value: (2 * index) / 63,
      inspection: { occurrences, interference: [] },
    }))
    const data = assemblyMotionExportData(study, 7, samples)
    let camera: ModelPreviewOptions | undefined
    render.mockImplementationOnce((_meshes, options) => {
      camera = options
      throw new Error("Stop after camera inspection.")
    })
    await expect(
      assemblyMotionPngSequence(data, samples, new AbortController().signal),
    ).rejects.toThrow("Stop after camera inspection.")
    expect(render).toHaveBeenCalledTimes(1)
    expect(camera?.camera?.target).toEqual([45, 90, 135])
    expect(camera?.camera?.viewHeightMm).toBeCloseTo(Math.hypot(110, 220, 330) * 1.2, 10)
  })
  it("exports actual solved frames and transformed source-point traces in canonical CSV/JSON units", () => {
    const samples = [
      { value: 0, inspection: inspection(10) },
      { value: 2, inspection: inspection(20) },
    ]
    const data = assemblyMotionExportData(study, 7, samples, {
      instanceId: id(4),
      sourceIndex: 0,
      point: [1, 0, 0],
    })
    expect(data.samples[0]?.tracePointMm?.[0]).toBeCloseTo(10, 12)
    expect(data.samples[0]?.tracePointMm?.[1]).toBeCloseTo(3, 12)
    expect(data.samples[1]?.tracePointMm?.[0]).toBeCloseTo(20, 12)
    expect(data.units).toEqual({ translation: "mm", angle: "rad", time: "s", quaternion: "xyzw" })
    expect(JSON.stringify(data)).not.toContain("positions")
    const csvRows = assemblyMotionCsv(data).split("\n")
    expect(csvRows).toHaveLength(4)
    expect(csvRows[0]).toBe(
      "study_id,revision,time_s,instance_id,source_index,x_mm,y_mm,z_mm,qx,qy,qz,qw,trace_x_mm,trace_y_mm,trace_z_mm",
    )
    expect(csvRows.slice(1, -1).map((row) => row.split(",").slice(0, 4))).toEqual([
      [id(1), "7", "0", id(4)],
      [id(1), "7", "2", id(4)],
    ])
    expect(csvRows[2]).toContain(`${id(1)},7,2,${id(4)},0,20,2,3,`)
    expect(() =>
      assemblyMotionExportData(study, 7, samples, {
        instanceId: id(9),
        sourceIndex: 0,
        point: [0, 0, 0],
      }),
    ).toThrow()
    expect(() => assemblyMotionExportData(study, 7, [])).toThrow()
  })
  it("uses one fixed camera for real solved meshes and packages indexed frames with their manifest", async () => {
    render.mockClear()
    const samples = [
      { value: 0, inspection: inspection(10) },
      { value: 2, inspection: inspection(20) },
    ]
    const data = assemblyMotionExportData(study, 7, samples)
    const zip = await assemblyMotionPngSequence(data, samples, new AbortController().signal)
    const files = unzipSync(zip)
    expect(Object.keys(files)).toEqual(["motion.json", "frame-0001.png", "frame-0002.png"])
    expect(JSON.parse(new TextDecoder().decode(files["motion.json"]))).toEqual(data)
    expect(render).toHaveBeenCalledTimes(2)
    expect(render.mock.calls[0]?.[1]).toEqual(render.mock.calls[1]?.[1])
    expect(render.mock.calls[0]?.[0][0].positions).toBe(
      samples[0]?.inspection.occurrences[0]?.mesh.positions,
    )
  })
  it("aborts after a pending render without rendering or downloading additional frames", async () => {
    render.mockClear()
    let finish!: () => void
    render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ base64: "iVBORw0KGgo=" })
        }),
    )
    const samples = [
      { value: 0, inspection: inspection(10) },
      { value: 2, inspection: inspection(20) },
    ]
    const abort = new AbortController(),
      pending = assemblyMotionPngSequence(
        assemblyMotionExportData(study, 7, samples),
        samples,
        abort.signal,
      )
    await new Promise((resolve) => setTimeout(resolve, 0))
    abort.abort()
    finish()
    await expect(pending).rejects.toThrow()
    expect(render).toHaveBeenCalledTimes(1)
  })
})
