import { beforeAll, describe, expect, it } from "bun:test"
import { makeCylinder, setOC } from "replicad"
import initializeOpenCascade from "replicad-opencascadejs"
import { captureReplicadTopologySnapshot } from "./topology-signatures"

beforeAll(async () => {
  const wasmBinary = await Bun.file(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  ).bytes()
  setOC(await Reflect.apply(initializeOpenCascade, undefined, [{ wasmBinary }]))
})

describe("exact topology signatures", () => {
  it("keeps curved edge and face signatures independent of display tessellation", () => {
    const outer = makeCylinder(34, 147)
    const bore = makeCylinder(31.6, 147)
    const tube = outer.cut(bore)
    try {
      const signatures = () =>
        captureReplicadTopologySnapshot(tube).candidates.map(({ kind, signature }) => ({
          kind,
          signature,
        }))
      const exact = signatures()
      const innerTop = exact.find(
        ({ kind, signature }) =>
          kind === "edge" &&
          signature.geometryClass === "CIRCLE" &&
          Math.abs(signature.measure - 2 * Math.PI * 31.6) < 1e-7 &&
          Math.abs(signature.centroid[2] - 147) < 1e-7,
      )
      expect(innerTop).toBeDefined()
      expect(innerTop?.signature.bounds.min[0]).toBeCloseTo(-31.6, 5)
      expect(innerTop?.signature.bounds.max[2]).toBeCloseTo(147, 5)
      for (const tolerance of [0.5, 0.05, 0.01]) {
        tube.mesh({ tolerance, angularTolerance: 0.1 })
        expect(signatures()).toEqual(exact)
      }
    } finally {
      tube.delete()
      bore.delete()
      outer.delete()
    }
  })
})
