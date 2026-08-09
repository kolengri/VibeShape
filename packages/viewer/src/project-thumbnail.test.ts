import { describe, expect, it } from "vitest"
import { renderProjectThumbnail } from "./project-thumbnail"
import type { ViewerMesh } from "./three-viewport"

const triangle: ViewerMesh = {
  featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 12, 8]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}

describe("project thumbnail", () => {
  it("renders deterministic bounded SVG from authoritative mesh triangles", () => {
    const first = renderProjectThumbnail([triangle])
    const second = renderProjectThumbnail([triangle])

    expect(first).toEqual(second)
    expect(first?.mediaType).toBe("image/svg+xml")
    expect(first?.bytes.byteLength).toBeLessThan(1_024)
    expect(new TextDecoder().decode(first?.bytes)).toMatch(
      /^<svg[^>]+viewBox="0 0 240 160".+<polygon points="[\d., ]+"/,
    )
  })

  it("omits a preview when no valid triangle exists", () => {
    expect(renderProjectThumbnail([])).toBeNull()
    expect(
      renderProjectThumbnail([{ ...triangle, indices: new Uint32Array([0, 1, 99]) }]),
    ).toBeNull()
  })
})
