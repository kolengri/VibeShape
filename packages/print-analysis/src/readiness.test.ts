import { describe, expect, it } from "bun:test"
import type { PrintPreparationMesh } from "@vibeshape/protocol"
import { preparePrintMeshes } from "./index"
import { analyzePrintReadiness, MAX_READINESS_TRIANGLES } from "./readiness"

const triangles = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4,
  3, 4, 7,
]
function box(z = 2): PrintPreparationMesh {
  return {
    name: "Box",
    vertices: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, z, 10, 0, z, 10, 10, z, 0, 10, z],
    triangles,
  }
}
const settings = { minimumWallMm: 1, overhangAngleDeg: 45 }
const immediate = { yield: async () => {} }
describe("oriented print readiness", () => {
  it("measures parallel walls and exempts only flat bed-contact triangles", async () => {
    const result = await analyzePrintReadiness([box()], settings, immediate)
    expect(result.status).toBe("no-findings")
    expect(result.bodies[0]?.minimumThicknessMm).toBeCloseTo(2, 4)
    expect(result.bodies[0]?.overhangTriangles).toEqual([])
    const thin = await analyzePrintReadiness([box(0.4)], settings, immediate)
    expect(thin.status).toBe("warnings")
    expect(thin.bodies[0]?.thinTriangles).toEqual([0, 1, 2, 3])
    expect(thin.bodies[0]?.thinAreaMm2).toBeCloseTo(200, 4)
  })
  it("uses the prepared print orientation and exact face normals", async () => {
    const wedge = {
      name: "Wedge",
      vertices: [0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 10, 0, 10, 10, 0, 0, 10, 10],
      triangles: [0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2],
    }
    const prepared = preparePrintMeshes({
      meshes: [wedge],
      settings: { rotationX: 180, rotationY: 0, rotationZ: 0, supports: false },
    })
    const result = await analyzePrintReadiness(
      prepared.meshes,
      { ...settings, overhangAngleDeg: 40 },
      immediate,
    )
    expect(result.bodies[0]?.topology).toBe("closed")
    expect(result.bodies[0]?.overhangTriangles).toEqual([6, 7])
    expect(result.bodies[0]?.unknownTriangles).toBe(0)
    expect(result.bodies[0]?.minimumThicknessMm).toBeGreaterThan(0)
  })
  it("uses one shared bed for floating bodies and leaves near-coincident cracks unknown", async () => {
    const source = box()
    const raised = { ...source, vertices: source.vertices.map((v, i) => (i % 3 === 2 ? v + 5 : v)) }
    const floating = await analyzePrintReadiness([source, raised], settings, immediate)
    expect(floating.bodies[1]?.overhangTriangles).toEqual([0, 1])
    const duplicated = {
      ...source,
      vertices: source.triangles.flatMap((i) => source.vertices.slice(i * 3, i * 3 + 3)),
      triangles: source.triangles.map((_, i) => i),
    }
    duplicated.vertices[0] = (duplicated.vertices[0] ?? 0) + 1e-8
    expect((await analyzePrintReadiness([duplicated], settings, immediate)).status).toBe("unknown")
  })
  it("never reports no-findings for open, reversed, degenerate or over-budget meshes", async () => {
    const source = box()
    for (const mesh of [
      { ...source, triangles: triangles.slice(3) },
      { ...source, triangles: [...triangles].reverse() },
      { ...source, triangles: [0, 0, 1, ...triangles.slice(3)] },
      {
        ...source,
        triangles: Array.from({ length: (MAX_READINESS_TRIANGLES + 1) * 3 }, (_, i) => i % 3),
      },
    ]) {
      const result = await analyzePrintReadiness([mesh], settings, immediate)
      expect(result.status).toBe("unknown")
      expect(result.bodies[0]?.unknownTriangles).toBeGreaterThan(0)
    }
  })
  it("recognizes face-local duplicate vertices and translated closed bodies", async () => {
    const source = box()
    const duplicated = {
      ...source,
      vertices: source.triangles.flatMap((i) =>
        source.vertices.slice(i * 3, i * 3 + 3).map((v) => v + 1000),
      ),
      triangles: source.triangles.map((_, i) => i),
    }
    const result = await analyzePrintReadiness([duplicated], settings, immediate)
    expect(result.status).toBe("no-findings")
    expect(result.bodies[0]?.minimumThicknessMm).toBeCloseTo(2, 3)
  })
  it("checks cancellation before work and between chunks without publishing a partial report", async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(
      analyzePrintReadiness([box()], settings, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    const mid = new AbortController()
    await expect(
      analyzePrintReadiness([box()], settings, {
        signal: mid.signal,
        yield: async () => {
          mid.abort()
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
  })
})
