import { beforeAll, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { resolveSelectedEdgeCandidates } from "../packages/application/src/selected-edge-resolution"
import { inspectOcctBody } from "../packages/geometry-worker/src/occt-body-validation"
import { treatSelectedOcctEdges } from "../packages/geometry-worker/src/occt-edge-treatment"
import { createOcctCylinder } from "../packages/geometry-worker/src/occt-shapes"
import { resolveSelectedEdgeKeys } from "../packages/geometry-worker/src/selected-edge-resolver"
import { captureReplicadTopologySnapshot } from "../packages/geometry-worker/src/topology-signatures"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const wasmBinary = readFileSync(
    new URL(
      "../packages/geometry-worker/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
      import.meta.url,
    ),
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [{ wasmBinary }])
  setOC(occt)
})

describe("selected circular edge treatment with real OCCT", () => {
  it.each(["fillet", "chamfer"] as const)(
    "treats the picked rim beside a similar rim with %s and preserves the source",
    (operation) => {
      const source = createOcctCylinder(occt, 20, 0.5, [0, 0, 0])
      try {
        const snapshot = captureReplicadTopologySnapshot(source)
        const rims = snapshot.candidates.filter(
          ({ kind, signature }) => kind === "edge" && signature.geometryClass === "CIRCLE",
        )
        expect(rims).toHaveLength(2)
        const originalVolume = measureVolume(source)
        for (const rim of rims) {
          const candidateIds = resolveSelectedEdgeCandidates(
            [{ schemaVersion: 0, kind: "edge", inputIndex: 0, signature: rim.signature }],
            snapshot.candidates,
            "0195b5ac-b220-7a2c-8c33-67a36a7f3302",
          )
          expect(candidateIds).toEqual([rim.candidateId])
          const result = treatSelectedOcctEdges(
            occt,
            source,
            operation,
            0.05,
            resolveSelectedEdgeKeys(candidateIds, snapshot.transientShapeKeys),
          )
          try {
            const metrics = inspectOcctBody(occt, result)
            expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
            expect(metrics.volume).toBeGreaterThan(0)
            expect(metrics.volume).toBeLessThan(originalVolume)
            expect(measureVolume(source)).toBeCloseTo(originalVolume, 8)
          } finally {
            result.delete()
          }
        }
      } finally {
        source.delete()
      }
    },
  )
})
