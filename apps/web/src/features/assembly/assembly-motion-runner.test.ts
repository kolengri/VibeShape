import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { AssemblyMotionTarget } from "./assembly-motion-runner"
import type { AssemblyPlaybackOptions } from "./use-assembly-motion"

const preview = vi.fn()
const controllerModule = { ...(await import("../../document/document-controller")) }
mock.module("../../document/document-controller", () => ({
  ...controllerModule,
  previewAssemblyChanges: preview,
}))
const { solveAssemblyMotionSweep } = await import("./assembly-motion-runner")
const inspection: AssemblyInspection = { occurrences: [], interference: [] }

beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
  preview.mockReset()
  preview.mockResolvedValue({ ok: true, inspection })
})
afterEach(() => vi.useRealTimers())

function run({
  values,
  unit = "seconds",
  playing = true,
  options = {},
  stopAfter,
}: {
  values: readonly number[]
  unit?: AssemblyMotionTarget["sampleUnit"]
  playing?: boolean
  options?: AssemblyPlaybackOptions
  stopAfter?: number
}) {
  const abort = new AbortController()
  const published: { value: number; at: number }[] = []
  let completed = false
  const running = solveAssemblyMotionSweep({
    target: { revision: 7, sampleUnit: unit, changes: () => [] },
    values,
    signal: abort.signal,
    playing,
    options,
    pending: () => {},
    publish(sample) {
      published.push({ value: sample.value, at: Date.now() })
      if (published.length === stopAfter) abort.abort()
    },
  }).then(() => {
    completed = true
  })
  return { abort, published, running, completed: () => completed }
}

describe("assembly motion playback cadence", () => {
  it.each([
    { name: "one-second uneven intervals", values: [0, 0.25, 1], speed: 1, times: [0, 250, 1000] },
    { name: "sixty-second study", values: [0, 30, 60], speed: 1, times: [0, 30_000, 60_000] },
    {
      name: "double-speed reverse study",
      values: [60, 30, 0],
      speed: 2,
      times: [0, 15_000, 30_000],
    },
  ])(
    "uses authored seconds for $name and finishes at the last sample",
    async ({ values, speed, times }) => {
      const result = run({ values, options: { speed } })
      await vi.advanceTimersByTimeAsync(times.at(-1) ?? 0)
      expect(result.published.map((sample) => sample.value)).toEqual([...values])
      expect(result.published.map((sample) => sample.at)).toEqual([...times])
      expect(result.completed()).toBe(true)
      expect(preview).toHaveBeenCalledTimes(3)
      expect(preview.mock.calls.every((call) => call[1] === 7)).toBe(true)
      await result.running
    },
  )

  it.each([
    [-Math.PI, 0, Math.PI],
    [-1000, 0, 1000],
  ])(
    "keeps manual joint-coordinate values %j independent of seconds",
    async (first, middle, last) => {
      const values = [first, middle, last]
      const result = run({ values, unit: "joint-coordinate", options: { speed: 2 } })
      await vi.advanceTimersByTimeAsync(200)
      expect(result.published).toEqual([
        { value: first, at: 0 },
        { value: middle, at: 100 },
        { value: last, at: 200 },
      ])
      expect(result.completed()).toBe(true)
      await result.running
    },
  )

  it("solves non-playing seeks and sweeps without scheduling playback waits", async () => {
    const result = run({ values: [0, 30, 60], playing: false })
    await result.running
    expect(result.published).toEqual([
      { value: 0, at: 0 },
      { value: 30, at: 0 },
      { value: 60, at: 0 },
    ])
    expect(result.completed()).toBe(true)
  })

  it("aborts a long authored interval without publishing or solving another pose", async () => {
    const result = run({ values: [0, 30, 60] })
    await vi.advanceTimersByTimeAsync(5000)
    expect(result.published).toEqual([{ value: 0, at: 0 }])
    result.abort.abort()
    await result.running
    await vi.advanceTimersByTimeAsync(60_000)
    expect(result.published).toEqual([{ value: 0, at: 0 }])
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it.each([
    { unit: "seconds", values: [0, 1], times: [0, 1000, 1000, 2000, 2000] },
    { unit: "joint-coordinate", values: [0, 1000], times: [0, 200, 200, 400, 400] },
  ] as const)(
    "replays the cached $unit loop at its cadence without an end pause",
    async ({ unit, values, times }) => {
      const result = run({ values, unit, options: { loop: true }, stopAfter: 5 })
      await vi.advanceTimersByTimeAsync(times[4])
      await result.running
      expect(result.published.map((sample) => sample.at)).toEqual([...times])
      expect(result.published.map((sample) => sample.value)).toEqual([
        values[0],
        values[1],
        values[0],
        values[1],
        values[0],
      ])
      expect(preview).toHaveBeenCalledTimes(2)
      expect(result.completed()).toBe(true)
    },
  )

  it("adds disposable solver work to the authored interval rather than promising real-time playback", async () => {
    preview.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, inspection }), 100)),
    )
    const result = run({ values: [0, 1] })
    await vi.advanceTimersByTimeAsync(1200)
    expect(result.published).toEqual([
      { value: 0, at: 100 },
      { value: 1, at: 1200 },
    ])
    expect(result.completed()).toBe(true)
    await result.running
  })
})
