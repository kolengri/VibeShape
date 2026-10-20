import { describe, expect, it } from "bun:test"
import { Group, Mesh, MeshBasicMaterial } from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { FaceHighlightPresentation } from "./face-highlights"
import type { ViewerMesh, ViewerSelection } from "./three-viewport"

describe("retained multi-face selection overlays", () => {
  it("skips equivalent selections and refreshes changed source snapshots without owning their buffers", () => {
    const mesh: ViewerMesh = {
      featureId: "body",
      outputRole: "left",
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      triangleFaceIds: new Uint32Array([7]),
    }
    const selection: ViewerSelection = {
      featureId: "body",
      outputRole: "left",
      faceId: 7,
      faceOrdinal: 1,
    }
    const sources = new Map([["body\u0000left", mesh]])
    const group = new Group()
    const material = new MeshBasicMaterial()
    const presentation = new FaceHighlightPresentation(group, material, sources)
    try {
      expect(presentation.setSelections([selection])).toBe(true)
      const first = group.children[0]
      if (!(first instanceof Mesh)) throw new Error("Expected an extracted face.")
      const released = vi.spyOn(first.geometry, "dispose")
      expect(presentation.setSelections([{ ...selection }])).toBe(false)
      expect(group.children[0]).toBe(first)
      expect(released).not.toHaveBeenCalled()
      const next = structuredClone(mesh)
      next.positions[0] = -12
      sources.set("body\u0000left", next)
      expect(presentation.setSelections([selection])).toBe(true)
      expect(released).toHaveBeenCalledTimes(1)
      const replacement = group.children[0]
      if (!(replacement instanceof Mesh)) throw new Error("Expected a replacement face.")
      expect(replacement.geometry.getAttribute("position").getX(0)).toBe(-12)
      expect(next.positions[0]).toBe(-12)
      sources.clear()
      expect(presentation.setSelections([selection])).toBe(true)
      expect(group.children).toHaveLength(0)
      sources.set("body\u0000left", mesh)
      presentation.setSelections([{ ...selection, faceId: 99 }])
      expect(group.children).toHaveLength(0)
      presentation.clear()
      expect(presentation.setSelections([selection])).toBe(true)
    } finally {
      presentation.clear()
      material.dispose()
    }
  })
})
