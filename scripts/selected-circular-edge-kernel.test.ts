import { beforeAll, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { resolveSelectedEdgeCandidates } from "../packages/application/src/selected-edge-resolution"
import { inspectOcctBody } from "../packages/geometry-worker/src/occt-body-validation"
import { treatSelectedOcctEdges } from "../packages/geometry-worker/src/occt-edge-treatment"
import { createOcctCylinder, cutOcctShapes } from "../packages/geometry-worker/src/occt-shapes"
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
  for (const fixture of [
    {
      name: "closely spaced circular rims",
      radius: 20,
      height: 0.5,
      distance: 0.05,
      create: () => createOcctCylinder(occt, 20, 0.5, [0, 0, 0]),
    },
    {
      name: "a thin annular wall",
      radius: 31.6,
      height: 147,
      distance: 1,
      create: () => {
        const outer = createOcctCylinder(occt, 34, 147, [0, 0, 0])
        const bore = createOcctCylinder(occt, 31.6, 147, [0, 0, 0])
        try {
          return cutOcctShapes(occt, outer, bore)
        } finally {
          bore.delete()
          outer.delete()
        }
      },
    },
  ]) {
    it.each(["fillet", "chamfer"] as const)(
      `applies %s to ${fixture.name} from a meshed selection on a cold rebuild`,
      (operation) => {
        for (const tolerance of [0.5, 0.05, 0.01]) {
          const displayed = fixture.create()
          const rebuilt = fixture.create()
          try {
            displayed.mesh({ tolerance, angularTolerance: 0.1 })
            const selection = captureReplicadTopologySnapshot(displayed).candidates.find(
              ({ kind, signature }) =>
                kind === "edge" &&
                signature.geometryClass === "CIRCLE" &&
                Math.abs(signature.measure - 2 * Math.PI * fixture.radius) < 1e-7 &&
                Math.abs(signature.centroid[2] - fixture.height) < 1e-7,
            )
            if (!selection) throw new Error("Fixture requires one top circular rim.")
            const cold = captureReplicadTopologySnapshot(rebuilt)
            const candidateIds = resolveSelectedEdgeCandidates(
              [{ schemaVersion: 0, kind: "edge", inputIndex: 0, signature: selection.signature }],
              cold.candidates,
              "0195b5ac-b220-7a2c-8c33-67a36a7f3302",
            )
            expect(candidateIds).toHaveLength(1)
            const selected = cold.candidates.find(({ candidateId }) =>
              candidateIds.includes(candidateId),
            )
            expect(selected?.signature.centroid[2]).toBeCloseTo(fixture.height, 7)
            expect(selected?.signature.measure).toBeCloseTo(2 * Math.PI * fixture.radius, 7)
            const volume = measureVolume(rebuilt)
            const result = treatSelectedOcctEdges(
              occt,
              rebuilt,
              operation,
              fixture.distance,
              resolveSelectedEdgeKeys(candidateIds, cold.transientShapeKeys),
            )
            try {
              const metrics = inspectOcctBody(occt, result)
              expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
              expect(metrics.volume).toBeGreaterThan(0)
              expect(metrics.volume).toBeLessThan(volume)
              expect(measureVolume(rebuilt)).toBeCloseTo(volume, 7)
              expect(measureVolume(displayed)).toBeCloseTo(volume, 7)
            } finally {
              result.delete()
            }
          } finally {
            rebuilt.delete()
            displayed.delete()
          }
        }
      },
    )
  }

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
