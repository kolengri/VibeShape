import type { ShellFeatureContentParameters } from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import { describe, expect, it, vi } from "vitest"
import { type BodyFaceResolver, takeResolvedBodyFace } from "./occt-body-face"
import type { TopologyCaptureSnapshot } from "./topology-signatures"

const reference: ShellFeatureContentParameters["openings"][number] = {
  schemaVersion: 1,
  kind: "face",
  outputRole: "pattern.instance.1",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 10,
    centroid: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
}
const scope = { featureId: "source", outputRole: "pattern.instance.1" }
const snapshot: TopologyCaptureSnapshot = {
  candidates: [],
  transientShapeKeys: new Map([["face:current", 7]]),
}
const resolve: BodyFaceResolver = () => ({ ok: true, candidateIds: ["face:current"] })
function sourceWithKeys(keys: readonly number[]) {
  const faces = keys.map((hashCode) => ({ hashCode, delete: vi.fn() }))
  const source = { faces, delete: vi.fn() }
  return { source, target: source as unknown as Shape3D, faces }
}
describe("exact body face ownership", () => {
  it("binds the authored role before transferring one owned face", () => {
    const { target, source, faces } = sourceWithKeys([3, 7, 9])
    const resolver = vi.fn(resolve)
    const face = takeResolvedBodyFace(target, snapshot, reference, scope, resolver)
    expect(resolver).toHaveBeenCalledWith([reference], snapshot.candidates, scope)
    expect(face).toBe(faces[1])
    expect(faces[0]?.delete).toHaveBeenCalledOnce()
    expect(faces[1]?.delete).not.toHaveBeenCalled()
    expect(faces[2]?.delete).toHaveBeenCalledOnce()
    expect(source.delete).not.toHaveBeenCalled()
    face.delete()
    expect(faces[1]?.delete).toHaveBeenCalledOnce()
  })
  it("fails before native acquisition when stable resolution is ambiguous", () => {
    const { target, faces } = sourceWithKeys([7])
    expect(() =>
      takeResolvedBodyFace(target, snapshot, reference, scope, () => ({
        ok: false,
        reason: "ambiguous",
      })),
    ).toThrow("unavailable or ambiguous")
    expect(faces[0]?.delete).not.toHaveBeenCalled()
  })
  it.each([{ keys: [7, 7] }, { keys: [2, 3] }])(
    "releases every acquired wrapper for native keys $keys",
    ({ keys }) => {
      const { target, source, faces } = sourceWithKeys(keys)
      expect(() => takeResolvedBodyFace(target, snapshot, reference, scope, resolve)).toThrow(
        "missing or ambiguous",
      )
      for (const face of faces) expect(face.delete).toHaveBeenCalledOnce()
      expect(source.delete).not.toHaveBeenCalled()
    },
  )
  it("never accepts an edge from a malformed resolver result", () => {
    const { target, faces } = sourceWithKeys([7])
    expect(() =>
      takeResolvedBodyFace(target, snapshot, reference, scope, () => ({
        ok: true,
        candidateIds: ["edge:current"],
      })),
    ).toThrow("missing")
    expect(faces[0]?.delete).not.toHaveBeenCalled()
  })
})
