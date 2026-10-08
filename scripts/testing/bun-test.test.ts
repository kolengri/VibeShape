import { afterEach, expect, it } from "bun:test"
import { vi } from "../../tests/unit/support/bun-test"
import { matchValue } from "../../tests/unit/support/match-value"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

it("advances promise continuations and their nested timers in deadline order", async () => {
  vi.useFakeTimers({ now: 0 })
  const events: number[] = []
  setTimeout(async () => {
    events.push(Date.now())
    await Promise.resolve()
    setTimeout(() => events.push(Date.now()), 10)
  }, 10)
  await vi.advanceTimersByTimeAsync(20)
  expect(events).toEqual([10, 20])
  expect(vi.getTimerCount()).toBe(0)
})

it("preserves native microtasks and React's immediate task scheduling", async () => {
  vi.useFakeTimers()
  const events: string[] = []
  await new Promise<void>((resolve) =>
    queueMicrotask(() => {
      events.push("microtask")
      resolve()
    }),
  )
  await new Promise<void>((resolve) =>
    setImmediate(() => {
      events.push("immediate")
      resolve()
    }),
  )
  expect(events).toEqual(["microtask", "immediate"])
})

it("supports selective timers without replacing the wall clock", async () => {
  const originalDate = Date
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const callback = vi.fn()
  setTimeout(callback, 500)
  await vi.advanceTimersByTimeAsync(499)
  expect(callback).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(callback).toHaveBeenCalledTimes(1)
  expect(Date).toBe(originalDate)
})

it("restores the timer implementations after an interrupted scenario", () => {
  const original = setTimeout
  vi.useFakeTimers()
  setTimeout(vi.fn(), 100)
  vi.useRealTimers()
  expect(setTimeout).toBe(original)
})

it("waits for delayed success and reports the last failure at the deadline", async () => {
  vi.useFakeTimers()
  let ready = false
  setTimeout(() => {
    ready = true
  }, 100)
  await vi.waitFor(() => expect(ready).toBe(true), { interval: 50 })
  const failure = new Error("The expected state was never reached.")
  await expect(
    vi.waitFor(
      () => {
        throw failure
      },
      { timeout: 20, interval: 10 },
    ),
  ).rejects.toBe(failure)
})

it("restores a replaced global descriptor and removes an originally absent global", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "fetch")
  vi.stubGlobal("fetch", vi.fn())
  vi.stubGlobal("__vibeshapeTestGlobal", "temporary")
  vi.unstubAllGlobals()
  expect(Object.getOwnPropertyDescriptor(globalThis, "fetch")).toEqual(original)
  expect(Object.hasOwn(globalThis, "__vibeshapeTestGlobal")).toBe(false)
})

it("restores environment variables after replacement and removal", () => {
  const previous = process.env.VIBESHAPE_TEST_ENV
  vi.stubEnv("VIBESHAPE_TEST_ENV", "first")
  vi.stubEnv("VIBESHAPE_TEST_ENV", undefined)
  vi.unstubAllEnvs()
  expect(process.env.VIBESHAPE_TEST_ENV).toBe(previous)
})

it("tracks and restores an own accessor without replacing its descriptor", () => {
  const subject = {
    value: 2,
    get doubled() {
      return this.value * 2
    },
  }
  const descriptor = Object.getOwnPropertyDescriptor(subject, "doubled")
  const spy = vi.spyOn(subject, "doubled", "get").mockReturnValue(7)
  expect(subject.doubled).toBe(7)
  expect(spy).toHaveBeenCalledTimes(1)
  spy.mockRestore()
  expect(Object.getOwnPropertyDescriptor(subject, "doubled")).toEqual(descriptor)
  expect(subject.doubled).toBe(4)
})

it("removes an inherited accessor's temporary own property when all spies are restored", () => {
  const subject = Object.create({
    get value() {
      return 2
    },
  }) as { value: number }
  vi.spyOn(subject, "value", "get").mockReturnValue(7)
  expect(subject.value).toBe(7)
  vi.restoreAllMocks()
  expect(Object.hasOwn(subject, "value")).toBe(false)
  expect(subject.value).toBe(2)
})

it("preserves subjects after Bun's nested asymmetric object matcher", () => {
  const value = { children: [{ id: "first" }, { id: "second" }], callback: vi.fn() }
  expect(matchValue(value)).toMatchObject({ children: [expect.anything(), { id: "second" }] })
  expect(value.children.map(({ id }) => id)).toEqual(["first", "second"])
  expect(matchValue(value).callback).toBe(value.callback)
  expect(() =>
    expect(matchValue(value)).toMatchObject({ children: [{ id: "wrong" }, expect.anything()] }),
  ).toThrow()
})

it("preserves asynchronously returned subjects after nested asymmetric object matching", async () => {
  const value = { children: [{ id: "first" }, { id: "second" }] }
  await expect(matchValue(Promise.resolve(value))).resolves.toMatchObject({
    children: [expect.anything(), { id: "second" }],
  })
  expect(value.children.map(({ id }) => id)).toEqual(["first", "second"])
})
