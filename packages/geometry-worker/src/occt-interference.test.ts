import { beforeAll, describe, expect, it } from "bun:test"
import { makeBox, measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { measureOcctInterference, type NativeInterferenceSource } from "./occt-interference"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const wasmPath = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { locateFile: () => wasmPath.pathname },
  ])
  setOC(occt)
}, 60_000)
const pose = (x = 0, y = 0, angle = 0): NativeInterferenceSource["pose"] => ({
  translation: [x, y, 0],
  quaternion: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)],
})

describe("exact assembly material intersections", () => {
  it("measures rigid translation and rotation without modifying native sources", () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    try {
      const identity = { shape, pose: pose() }
      const translated = measureOcctInterference(occt, [identity], [{ shape, pose: pose(1) }])
      expect(translated.solidCount).toBe(1)
      expect(translated.volume).toBeCloseTo(12, 8)
      const rotated = measureOcctInterference(
        occt,
        [identity],
        [{ shape, pose: pose(3, 0, Math.PI / 2) }],
      )
      expect(rotated.solidCount).toBe(1)
      expect(rotated.volume).toBeCloseTo(16, 8)
      expect(measureVolume(shape)).toBeCloseTo(24, 10)
    } finally {
      shape.delete()
    }
  })

  it("reports separated and touching faces as zero material", () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    try {
      for (const offset of [2, 20])
        expect(
          measureOcctInterference(occt, [{ shape, pose: pose() }], [{ shape, pose: pose(offset) }]),
        ).toEqual({ volume: 0, solidCount: 0 })
    } finally {
      shape.delete()
    }
  })

  it("measures exact separation, touch, containment and overlap after actual rigid placement", () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    const small = makeBox([0, 0, 0], [1, 1, 1])
    try {
      for (const [offset, gap, volume] of [
        [2.25, 0.25, 0],
        [2, 0, 0],
        [1, 0, 12],
      ]) {
        const result = measureOcctInterference(
          occt,
          [{ shape, pose: pose() }],
          [{ shape, pose: pose(offset) }],
          true,
        )
        expect(result.distance).toBeCloseTo(gap ?? -1, 8)
        expect(result.volume).toBeCloseTo(volume ?? -1, 8)
      }
      const contained = measureOcctInterference(
        occt,
        [{ shape, pose: pose() }],
        [{ shape: small, pose: pose(0.5, 0.5) }],
        true,
      )
      expect(contained.distance).toBeCloseTo(0, 8)
      expect(contained.volume).toBeCloseTo(1, 8)
      const rotated = measureOcctInterference(
        occt,
        [{ shape, pose: pose() }],
        [{ shape, pose: pose(8, 0, Math.PI / 2) }],
        true,
      )
      expect(rotated.distance).toBeCloseTo(3, 8)
      expect(rotated.volume).toBe(0)
      for (let index = 0; index < 20; index++)
        expect(
          measureOcctInterference(occt, [{ shape, pose: pose() }], [{ shape, pose: pose(4) }], true)
            .distance,
        ).toBeCloseTo(2, 8)
      expect(measureVolume(shape)).toBeCloseTo(24, 10)
    } finally {
      small.delete()
      shape.delete()
    }
  })

  it("unions overlapping definition pins before counting material and retains disconnected intersections", () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    const spanning = makeBox([0, 0, 0], [12, 3, 4])
    try {
      const duplicate = [
        { shape, pose: pose() },
        { shape, pose: pose() },
      ]
      expect(measureOcctInterference(occt, duplicate, duplicate).volume).toBeCloseTo(24, 8)
      const result = measureOcctInterference(
        occt,
        [
          { shape, pose: pose() },
          { shape, pose: pose(10) },
        ],
        [{ shape: spanning, pose: pose() }],
      )
      expect(result.solidCount).toBe(2)
      expect(result.volume).toBeCloseTo(48, 8)
      expect(measureVolume(spanning)).toBeCloseTo(144, 10)
    } finally {
      spanning.delete()
      shape.delete()
    }
  })

  it("rejects invalid placement and resource bounds, then remains usable", () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    try {
      const source = { shape, pose: pose() }
      expect(() => measureOcctInterference(occt, [], [source])).toThrow(/sixteen/)
      expect(() =>
        measureOcctInterference(
          occt,
          Array.from({ length: 17 }, () => source),
          [source],
        ),
      ).toThrow(/sixteen/)
      expect(() =>
        measureOcctInterference(
          occt,
          [source],
          [{ shape, pose: { ...pose(), quaternion: [0, 0, 0, 2] } }],
        ),
      ).toThrow()
      for (let index = 0; index < 20; index++)
        expect(measureOcctInterference(occt, [source], [source]).volume).toBeCloseTo(24, 8)
      expect(measureVolume(shape)).toBeCloseTo(24, 10)
    } finally {
      shape.delete()
    }
  })
})
