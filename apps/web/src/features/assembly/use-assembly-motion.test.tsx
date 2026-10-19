import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { assemblyMotionStudySchema } from "@vibeshape/domain/assembly-authority"
import { assemblyJointRecordSchema } from "@vibeshape/domain/assembly-mates"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose } from "./assembly-model"
import { assemblyMotionCoordinates } from "./assembly-motion"

const ports = { preview: vi.fn(), apply: vi.fn() }
const controllerModule = { ...(await import("../../document/document-controller")) }
mock.module("../../document/document-controller", () => ({
  ...controllerModule,
  previewAssemblyChanges: ports.preview,
}))
const { useAssemblyMotion } = await import("./use-assembly-motion")
const joint = assemblyJointRecordSchema.parse({
  schemaVersion: 2,
  id: id(10),
  kind: "revolute",
  parentInstanceId: id(11),
  childInstanceId: id(12),
  parentFrame: identityAssemblyPose,
  childFrame: identityAssemblyPose,
  axis: [0, 0, 1],
  value: 0,
  limits: { min: -1, max: 1 },
  driven: false,
})
const coordinate = assemblyMotionCoordinates(joint)[0]
if (!coordinate) throw new Error("The motion fixture requires a coordinate.")
const inspection: AssemblyInspection = {
  occurrences: [],
  interference: [],
  kinematics: {
    status: "fully-constrained",
    degreesOfFreedom: 0,
    maximumResidual: 0,
    redundant: false,
    redundantJointIds: [],
  },
}
const options = {
  key: "project:7:joint:angle",
  joint,
  coordinate,
  revision: 7,
  disabled: false,
  onApply: ports.apply,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}
beforeEach(() => {
  ports.preview.mockReset()
  ports.apply.mockReset()
  ports.preview.mockResolvedValue({ ok: true, inspection })
  ports.apply.mockResolvedValue(true)
})
afterEach(cleanup)
describe("Disposable assembly motion", () => {
  it("serializes superseding seeks and ignores late results from the cancelled seek", async () => {
    const first = deferred<{ ok: true; inspection: AssemblyInspection }>()
    ports.preview.mockReturnValueOnce(first.promise)
    const hook = renderHook(() => useAssemblyMotion(options))
    let obsolete: Promise<void> | undefined, latest: Promise<void> | undefined
    act(() => {
      obsolete = hook.result.current.preview(-0.75)
      latest = hook.result.current.preview(0.75)
    })
    expect(ports.preview).toHaveBeenCalledTimes(1)
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal | undefined
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      first.resolve({ ok: true, inspection })
      await obsolete
      await latest
    })
    expect(ports.preview).toHaveBeenCalledTimes(2)
    expect(hook.result.current.value).toBe(0.75)
    expect(hook.result.current.samples.map(({ value }) => value)).toEqual([0.75])
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("plays exact reverse endpoints at a bounded count and cancels a loop on Pause", async () => {
    const hook = renderHook(() => useAssemblyMotion(options))
    await act(async () => {
      await hook.result.current.play(-1, 1, { count: 3, speed: 10, reverse: true })
    })
    expect(hook.result.current.samples.map(({ value }) => value)).toEqual([1, 0, -1])
    expect(hook.result.current.value).toBe(-1)
    let loop: Promise<void> | undefined
    act(() => {
      loop = hook.result.current.play(-1, 1, { count: 2, speed: 10, loop: true })
    })
    await waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(5))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(ports.preview).toHaveBeenCalledTimes(5)
    act(() => hook.result.current.pause())
    const last = hook.result.current.value,
      count = ports.preview.mock.calls.length
    await act(async () => {
      await loop
    })
    expect(ports.preview).toHaveBeenCalledTimes(count)
    expect(hook.result.current.value).toBe(last)
    expect(hook.result.current.playing).toBe(false)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("uses the selected study's seconds through playback without applying its solved poses", async () => {
    const study = assemblyMotionStudySchema.parse({
      schemaVersion: 1,
      id: id(20),
      name: "Sixty-second motion",
      duration: 60,
      tracks: [
        {
          id: id(21),
          jointId: joint.id,
          coordinate: "angle",
          keys: [
            { time: 0, value: -1 },
            { time: 60, value: 1 },
          ],
        },
      ],
    })
    vi.useFakeTimers({ now: 0 })
    const hook = renderHook(() => useAssemblyMotion({ ...options, study, joints: [joint] }))
    let playing: Promise<void> | undefined
    let completed = false
    try {
      act(() => {
        playing = hook.result.current.play(0, 60, { count: 3, speed: 2 })
        void playing?.then(() => {
          completed = true
        })
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(hook.result.current.value).toBe(0)
      await act(() => vi.advanceTimersByTimeAsync(14_999))
      expect(hook.result.current.value).toBe(0)
      expect(ports.preview).toHaveBeenCalledTimes(1)
      await act(() => vi.advanceTimersByTimeAsync(1))
      expect(hook.result.current.value).toBe(30)
      expect(ports.preview.mock.calls[1]?.[0]).toMatchObject([
        { kind: "joint.update", joint: { value: 0 } },
      ])
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      expect(hook.result.current.samples.map((sample) => sample.value)).toEqual([0, 30, 60])
      expect(hook.result.current.playing).toBe(false)
      expect(completed).toBe(true)
      expect(ports.apply).not.toHaveBeenCalled()
      await playing
    } finally {
      hook.unmount()
      vi.useRealTimers()
    }
  })
  it("previews without saving and makes Apply single-flight with retry after failure", async () => {
    const save = deferred<boolean>()
    const hook = renderHook(() => useAssemblyMotion(options))
    await act(async () => {
      await hook.result.current.preview(0.5)
    })
    expect(ports.apply).not.toHaveBeenCalled()
    expect(ports.preview.mock.calls[0]?.[1]).toBe(7)
    ports.apply.mockReturnValueOnce(save.promise)
    let applying!: Promise<boolean>
    act(() => {
      applying = hook.result.current.apply()
      void hook.result.current.apply()
    })
    expect(ports.apply).toHaveBeenCalledTimes(1)
    expect(ports.apply.mock.calls[0]).toMatchObject([
      [{ kind: "joint.update", joint: { value: 0.5, driven: true } }],
      7,
    ])
    await act(async () => {
      save.resolve(false)
      await applying
    })
    expect(hook.result.current.applying).toBe(false)
    expect(hook.result.current.error?.kind).toBe("save")
    await act(async () => {
      await hook.result.current.apply()
    })
    expect(ports.apply).toHaveBeenCalledTimes(2)
  })
  it("aborts reset, document transitions, and disposal and rejects late meshes", async () => {
    const late = deferred<{ ok: true; inspection: AssemblyInspection }>()
    ports.preview.mockReturnValueOnce(late.promise)
    const hook = renderHook(({ key }) => useAssemblyMotion({ ...options, key }), {
      initialProps: { key: options.key },
    })
    let pending!: Promise<void> | undefined
    act(() => {
      pending = hook.result.current.preview(0.4)
    })
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal
    act(() => hook.result.current.reset())
    expect(signal.aborted).toBe(true)
    await act(async () => {
      late.resolve({ ok: true, inspection })
      await pending
    })
    expect(hook.result.current.inspection).toBeNull()
    await act(async () => {
      await hook.result.current.preview(0.3)
    })
    hook.rerender({ key: "other-project:7:joint:angle" })
    expect(hook.result.current.inspection).toBeNull()
    ports.preview.mockReturnValueOnce(new Promise(() => {}))
    act(() => {
      void hook.result.current.preview(0.2)
    })
    const disposalSignal = ports.preview.mock.calls.at(-1)?.[3] as AbortSignal
    hook.unmount()
    expect(disposalSignal.aborted).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("pauses a bounded sweep, retaining only its last solved coordinate, and clears failure geometry", async () => {
    const hook = renderHook(() => useAssemblyMotion(options))
    let playing!: Promise<void> | undefined
    act(() => {
      playing = hook.result.current.play(-1, 1)
    })
    await waitFor(() => expect(hook.result.current.value).toBe(-1))
    act(() => hook.result.current.pause())
    await act(async () => {
      await playing
    })
    expect(hook.result.current.playing).toBe(false)
    expect(hook.result.current.value).toBe(-1)
    expect(ports.preview).toHaveBeenCalledTimes(1)
    expect(ports.apply).not.toHaveBeenCalled()
    ports.preview.mockResolvedValueOnce({
      ok: false,
      diagnostic: { message: "Closed loop is inconsistent." },
    })
    await act(async () => {
      await hook.result.current.preview(1)
    })
    expect(hook.result.current.inspection).toBeNull()
    expect(hook.result.current.error).toEqual({
      kind: "solver",
      reason: "Closed loop is inconsistent.",
      code: "unavailable",
    })
    expect(await hook.result.current.apply()).toBe(false)
  })
  it("rejects invalid coordinates and cancels a preview when authoring becomes unavailable", async () => {
    const hook = renderHook(({ disabled }) => useAssemblyMotion({ ...options, disabled }), {
      initialProps: { disabled: false },
    })
    act(() => {
      void hook.result.current.play(1, 1)
    })
    expect(hook.result.current.error?.kind).toBe("invalid")
    expect(ports.preview).not.toHaveBeenCalled()
    ports.preview.mockReturnValueOnce(new Promise(() => {}))
    act(() => {
      void hook.result.current.preview(0.2)
    })
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal
    hook.rerender({ disabled: true })
    expect(signal.aborted).toBe(true)
    expect(hook.result.current.inspection).toBeNull()
    expect(await hook.result.current.apply()).toBe(false)
  })
})
