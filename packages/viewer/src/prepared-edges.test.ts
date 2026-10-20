import { describe, expect, it } from "bun:test"
import { BoxGeometry } from "three"
import { edgePreparationFixture } from "../tests/edge-preparation-fixture"
import { PreparedEdges } from "./prepared-edges"

function surface() {
  const geometry = new BoxGeometry()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

const source = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
}

describe("prepared edge ownership", () => {
  it("installs the transferred attribute once, retains geometry identity and bounds, and requests one draw", async () => {
    const preparation = edgePreparationFixture()
    const geometry = surface()
    let draws = 0
    const edges = new PreparedEdges(preparation.client, source, geometry, () => {
      draws += 1
    })
    const retained = edges.geometry
    expect(retained.getAttribute("position")).toBeUndefined()
    expect(retained.boundingSphere).toEqual(geometry.boundingSphere)
    expect(retained.boundingSphere).not.toBe(geometry.boundingSphere)
    preparation.worker.complete()
    await Promise.resolve()
    expect(edges.geometry).toBe(retained)
    expect(retained.getAttribute("position").count).toBe(6)
    expect(draws).toBe(1)
    let disposals = 0
    retained.addEventListener("dispose", () => {
      disposals += 1
    })
    edges.dispose()
    edges.dispose()
    expect(disposals).toBe(1)
    preparation.client.dispose()
    geometry.dispose()
  })

  it("ignores a fulfilled promise if its owner is disposed before the continuation runs", async () => {
    const preparation = edgePreparationFixture()
    const geometry = surface()
    let draws = 0
    const edges = new PreparedEdges(preparation.client, source, geometry, () => {
      draws += 1
    })
    preparation.worker.complete()
    edges.dispose()
    await Promise.resolve()
    expect(edges.geometry.getAttribute("position")).toBeUndefined()
    expect(draws).toBe(0)
    preparation.client.dispose()
    geometry.dispose()
  })

  it("does no geometry work or drawing on failure or late completion after disposal", async () => {
    const preparation = edgePreparationFixture()
    const geometry = surface()
    let draws = 0
    const edges = new PreparedEdges(preparation.client, source, geometry, () => {
      draws += 1
    })
    edges.dispose()
    preparation.worker.complete()
    await Promise.resolve()
    expect(edges.geometry.getAttribute("position")).toBeUndefined()
    expect(draws).toBe(0)
    preparation.client.dispose()
    geometry.dispose()
  })
})
