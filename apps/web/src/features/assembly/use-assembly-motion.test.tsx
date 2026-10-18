import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
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
    })
    expect(await hook.result.current.apply()).toBe(false)
  })
  it("rejects invalid coordinates and cancels a preview when authoring becomes unavailable", async () => {
    const hook = renderHook(({ disabled }) => useAssemblyMotion({ ...options, disabled }), {
      initialProps: { disabled: false },
    })
    act(() => {
      void hook.result.current.play(1, -1)
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
