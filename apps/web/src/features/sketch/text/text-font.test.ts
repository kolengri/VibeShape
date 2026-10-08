import { afterEach, describe, expect, it } from "bun:test"
import { BUNDLED_SKETCH_TEXT_FONT } from "@vibeshape/domain/sketch-text"
import { vi } from "../../../../../../tests/unit/support/bun-test"

let moduleRevision = 0
afterEach(() => {
  vi.unstubAllGlobals()
  moduleRevision += 1
})
describe("bundled sketch font loading", () => {
  it("shares one local fetch and gives each outline operation an owned byte copy", async () => {
    const bytes = new Uint8Array(BUNDLED_SKETCH_TEXT_FONT.byteLength)
    bytes[0] = 42
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer })
    vi.stubGlobal("fetch", fetch)
    const { loadSketchTextFont } = (await import(
      `./text-font?test=${moduleRevision}`
    )) as typeof import("./text-font")
    const [first, second] = await Promise.all([loadSketchTextFont(), loadSketchTextFont()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toContain("NotoSans-Regular.ttf")
    first[0] = 0
    expect(second[0]).toBe(42)
    expect((await loadSketchTextFont())[0]).toBe(42)
  })
  it.each([
    { ok: false, arrayBuffer: async () => new ArrayBuffer(0) },
    { ok: true, arrayBuffer: async () => new ArrayBuffer(2) },
  ])("releases failed resources for a fresh retry", async (failure) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(BUNDLED_SKETCH_TEXT_FONT.byteLength),
      })
    vi.stubGlobal("fetch", fetch)
    const { loadSketchTextFont, SketchTextFontError } = (await import(
      `./text-font?test=${moduleRevision}`
    )) as typeof import("./text-font")
    await expect(loadSketchTextFont()).rejects.toBeInstanceOf(SketchTextFontError)
    expect((await loadSketchTextFont()).byteLength).toBe(BUNDLED_SKETCH_TEXT_FONT.byteLength)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
