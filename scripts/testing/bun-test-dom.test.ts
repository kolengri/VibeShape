import "../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { vi } from "../../tests/unit/support/bun-test"

afterEach(() => vi.unstubAllGlobals())

it("shares stubbed browser globals with window and restores both descriptors", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const windowDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage")
  const storage = { getItem: vi.fn(), setItem: vi.fn() }
  vi.stubGlobal("localStorage", storage)
  expect(globalThis.localStorage).toBe(storage as unknown as Storage)
  expect(window.localStorage).toBe(storage as unknown as Storage)
  vi.unstubAllGlobals()
  expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(descriptor)
  expect(Object.getOwnPropertyDescriptor(window, "localStorage")).toEqual(windowDescriptor)
})
