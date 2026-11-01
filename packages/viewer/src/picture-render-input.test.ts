import { describe, expect, it } from "bun:test"
import { pictureRenderCameraSchema } from "@vibeshape/domain/picture-render"
import { Box3, Mesh, Vector3 } from "three"
import {
  copyPictureRenderInput,
  createPictureCamera,
  pictureRenderSettingsSchema,
} from "./picture-render-input"
import { createPictureScene } from "./picture-render-scene"
import type { ViewerMesh } from "./three-viewport"

const triangle = (): ViewerMesh => ({
  featureId: "body",
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 12, 8]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
})

describe("picture input isolation and resource limits", () => {
  it("copies triangle buffers and appearance before normalization and keeps live buffers unchanged", () => {
    const live = {
      ...triangle(),
      material: { color: "#ee4422", roughness: 0.8, metalness: 0, opacity: 1 },
    }
    const positions = live.positions.slice()
    const snapshot = copyPictureRenderInput([live])
    live.material.color = "#000000"
    expect(snapshot.meshes[0]?.material?.color).toBe("#ee4422")
    const owned = createPictureScene(snapshot, pictureRenderSettingsSchema.parse({}))
    expect(live.positions).toEqual(positions)
    const surfaces = owned.scene.children.filter((child) => child instanceof Mesh)
    expect(surfaces).toHaveLength(2)
    owned.dispose()
    expect(live.positions).toEqual(positions)
  })
  it("rejects preview meshes, malformed buffers, duplicate bodies and invalid appearances", () => {
    expect(() => copyPictureRenderInput([{ ...triangle(), appearance: "preview" }])).toThrow(
      "committed",
    )
    expect(() =>
      copyPictureRenderInput([{ ...triangle(), indices: new Uint32Array([0, 1, 55]) }]),
    ).toThrow("malformed")
    expect(() => copyPictureRenderInput([triangle(), triangle()])).toThrow("unique")
    expect(() =>
      copyPictureRenderInput([
        { ...triangle(), material: { color: "#fff", metalness: 0, roughness: 0.5, opacity: 1 } },
      ]),
    ).toThrow("appearance")
  })
  it("enforces body, triangle and byte budgets before copying", () => {
    expect(() =>
      copyPictureRenderInput(
        Array.from({ length: 129 }, (_, i) => ({ ...triangle(), featureId: `body-${i}` })),
      ),
    ).toThrow("128")
    expect(() =>
      copyPictureRenderInput([{ ...triangle(), indices: new Uint32Array(600_003) }]),
    ).toThrow("200,000")
    expect(() =>
      copyPictureRenderInput([{ ...triangle(), positions: new Float32Array(8_400_000) }]),
    ).toThrow("32 MiB")
  })
  it("bounds dimensions and finish overrides without allowing unknown settings", () => {
    expect(pictureRenderSettingsSchema.safeParse({ width: 1920, height: 1920 }).success).toBe(false)
    expect(pictureRenderSettingsSchema.safeParse({ width: Infinity }).success).toBe(false)
    expect(pictureRenderSettingsSchema.safeParse({ samples: 1_000_000 }).success).toBe(false)
    expect(pictureRenderSettingsSchema.safeParse({ width: 1920, height: 1080 }).success).toBe(true)
    expect(
      pictureRenderSettingsSchema.safeParse({
        finishes: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`body-${i}`, "matte"])),
      }).success,
    ).toBe(false)
  })
})

describe("picture camera framing", () => {
  it("uses the shared domain camera contract at near-zero and angular boundaries", () => {
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(10, 10, 10))
    const settings = pictureRenderSettingsSchema.parse({ camera: "current" })
    for (const position of [
      [1e-8, 0, 0],
      [2e-8, 0, 0],
      [1, 0, 0.9999],
      [0, 0, 1],
    ] as const) {
      const pose = { position, target: [0, 0, 0] as const, up: [0, 0, 1] as const }
      if (pictureRenderCameraSchema.safeParse(pose).success)
        expect(() => createPictureCamera(bounds, settings, pose)).not.toThrow()
      else expect(() => createPictureCamera(bounds, settings, pose)).toThrow("invalid")
    }
  })
  it.each([
    [1280, 720],
    [720, 1280],
    [1080, 1080],
  ])("frames projected corners at %s × %s", (width, height) => {
    const bounds = new Box3(new Vector3(-1000, 500, -40), new Vector3(900, 520, 160))
    const settings = pictureRenderSettingsSchema.parse({ width, height })
    const camera = createPictureCamera(bounds, settings)
    const center = bounds.getCenter(new Vector3())
    const scale = 1 / bounds.getSize(new Vector3()).length()
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new Vector3(x, y, z).sub(center).multiplyScalar(scale).project(camera)
          expect(Math.abs(point.x)).toBeLessThan(0.9)
          expect(Math.abs(point.y)).toBeLessThan(0.9)
          expect(Math.abs(point.z)).toBeLessThan(1)
        }
  })
  it("preserves current orthographic scale and rejects degenerate camera bases", () => {
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(10, 10, 10))
    const settings = pictureRenderSettingsSchema.parse({ camera: "current" })
    const pose = {
      position: [0, -100, 0],
      target: [0, 0, 0],
      up: [0, 0, 1],
      viewHeightMm: 50,
    } as const
    const camera = createPictureCamera(bounds, settings, pose)
    expect(camera.top - camera.bottom).toBeCloseTo(50 / Math.sqrt(300))
    expect(() => createPictureCamera(bounds, settings)).toThrow("unavailable")
    expect(() => createPictureCamera(bounds, settings, { ...pose, position: [0, 0, 0] })).toThrow(
      "independent",
    )
    expect(() => createPictureCamera(bounds, settings, { ...pose, up: [0, 1, 0] })).toThrow(
      "independent",
    )
  })
})
