import { afterEach, describe, expect, it } from "bun:test"
/// <reference path="../packages/geometry-worker/src/vite-modules.d.ts" />
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { resolveShellOpeningCandidates } from "../packages/application/src/shell-opening-resolution"
import {
  createBodyTopologyReferenceProjector,
  modelBodyTopologyEvidenceSchema,
} from "../packages/domain/src/model-body-topology"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import {
  type FeatureEvaluationDependency,
  type FeatureEvaluationEngineResult,
  featureContentIdentitySchema,
  serializeFeatureContentIdentity,
} from "../packages/protocol/src/index"
import { testAssetPath } from "../tests/unit/support/assets"
import { vi } from "../tests/unit/support/bun-test"
import { matchValue } from "../tests/unit/support/match-value"

const id = (number: number) => `0195b5ac-b220-7a2c-8c33-${String(number).padStart(12, "0")}`
function requireSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
const featureType = (name: string) => ({
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: `org.vibeshape.feature.part-design.${name}`,
  schemaVersion: 1,
})
async function kernelFixture() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(await readFile(resolve(testAssetPath(url))))),
  )
  const engine = new ReplicadGeometryEngine(undefined, resolveShellOpeningCandidates)
  const metadata = await engine.initialize()
  expect(metadata.opencascadePackageVersion).toBe("0.23.0")
  const documentId = id(99)
  const evaluate = async (
    featureId: string,
    parameters: unknown,
    dependencies: readonly FeatureEvaluationDependency[] = [],
    name = "shell",
    schemaVersion = 1,
  ) => {
    const content = featureContentIdentitySchema.parse({
      schemaVersion: dependencies.length ? 1 : 0,
      environment: metadata.featureContentEnvironment,
      feature: {
        schemaVersion: 0,
        type: { ...featureType(name), schemaVersion },
        parameters,
        inputs: dependencies.map(({ contentHash }) => contentHash),
        references: [],
        ...(dependencies.length
          ? { inputRoles: dependencies.map(({ outputRole }) => outputRole) }
          : {}),
      },
    })
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serializeFeatureContentIdentity(content)),
    )
    const contentHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
    return {
      ...(await engine.evaluateFeature(
        {
          documentId,
          featureId,
          content,
          contentHash,
          dependencies: [...dependencies],
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        },
        vi.fn(),
      )),
      contentHash,
    }
  }
  return { engine, documentId, evaluate }
}
function openings(
  result: FeatureEvaluationEngineResult,
  contentHash: string,
  z: readonly number[],
) {
  const body = result.bodies?.[0]
  if (!body) throw new Error("Source must expose an exact body topology catalog.")
  const candidates = body.topologyCandidates
    .filter(({ kind }) => kind === "face")
    .map(({ candidateId, kind, semanticRole, lineageTokens, signature }) => ({
      candidateId,
      kind,
      semanticRole,
      lineageTokens,
      signature,
    }))
  const evidence = modelBodyTopologyEvidenceSchema.parse({
    schemaVersion: 1,
    documentId: id(99),
    revision: 0,
    generation: 0,
    rebuildId: "real-shell-test",
    featureId: id(1),
    outputRole: "result",
    contentHash,
    kind: "face",
    candidates,
  })
  const project = createBodyTopologyReferenceProjector(evidence)
  return candidates
    .filter((candidate) => z.includes(candidate.signature.centroid[2]))
    .map((candidate) => {
      const { featureId: _featureId, ...reference } = project(candidate)
      return reference
    })
}
const box = { width: 20, depth: 30, height: 40, centered: false, origin: [0, 0, 0] }
afterEach(() => vi.unstubAllGlobals())
describe("Shell with the pinned real OCCT kernel", () => {
  it("creates a closed v2 cavity in either direction and rejects collapse", async () => {
    const f = await kernelFixture()
    try {
      const source = requireSuccess(await f.evaluate(id(1), box, [], "box"))
      const dependency = { featureId: id(1), contentHash: source.contentHash, outputRole: "result" }
      for (const [index, direction, volume, min, max] of [
        [2, "inward", 4848, [-10, -15, 0], [10, 15, 40]],
        [3, "outward", 5568, [-11, -16, -1], [11, 16, 41]],
      ] as const) {
        const cavity = requireSuccess(
          await f.evaluate(
            id(index),
            {
              thickness: 1,
              direction,
              sourceContentHash: source.contentHash,
              openings: [],
            },
            [dependency],
            "shell",
            2,
          ),
        )
        expect(cavity.result.shape.valid).toBe(true)
        expect(cavity.result.shape.solidCount).toBe(1)
        expect(cavity.result.shape.faceCount).toBe(12)
        expect(cavity.result.shape.volume).toBeCloseTo(volume, 6)
        for (const axis of [0, 1, 2] as const) {
          expect(Math.abs(cavity.result.shape.bounds.min[axis] - min[axis])).toBeLessThanOrEqual(
            0.0011,
          )
          expect(Math.abs(cavity.result.shape.bounds.max[axis] - max[axis])).toBeLessThanOrEqual(
            0.0011,
          )
        }
        const exported = await f.engine.exportDocument({
          documentId: f.documentId,
          features: [
            { featureId: id(index), contentHash: cavity.contentHash, outputRole: "result" },
          ],
          format: "step",
        })
        const step = new TextDecoder().decode(exported.file)
        expect(exported.bodyCount).toBe(1)
        expect(step.match(/\bCLOSED_SHELL\s*\(/g)).toHaveLength(2)
        expect(step).toContain("BREP_WITH_VOIDS")
      }
      expect(
        await f.evaluate(
          id(4),
          {
            thickness: 100,
            direction: "inward",
            sourceContentHash: source.contentHash,
            openings: [],
          },
          [dependency],
          "shell",
          2,
        ),
      ).toMatchObject({ ok: false })
      expect(requireSuccess(await f.evaluate(id(1), box, [], "box")).result.shape).toEqual(
        source.result.shape,
      )
    } finally {
      f.engine.disposeDocument(f.documentId)
      expect(f.engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
  it("retains v2 openings through source edits and rejects signature-only or conflicting repair intent", async () => {
    const f = await kernelFixture()
    try {
      const source = requireSuccess(await f.evaluate(id(1), box, [], "box"))
      const selected = openings(source.result, source.contentHash, [40])
      const parameters = {
        thickness: 1,
        direction: "inward",
        sourceContentHash: source.contentHash,
        openings: selected,
      }
      const edited = requireSuccess(
        await f.evaluate(id(1), { ...box, width: 26, height: 45 }, [], "box"),
      )
      const dependency = { featureId: id(1), contentHash: edited.contentHash, outputRole: "result" }
      const retained = requireSuccess(await f.evaluate(id(2), parameters, [dependency], "shell", 2))
      expect(retained.result.shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(retained.result.shape.volume).toBeCloseTo(5532, 6)
      expect(matchValue(await f.evaluate(id(3), parameters, [dependency]))).toMatchObject({
        ok: false,
        diagnostic: { message: expect.stringContaining("Reselect") },
      })
      const signatureOnly = selected.map(
        ({ semanticRole: _role, lineageToken: _token, ...reference }) => reference,
      )
      expect(
        matchValue(
          await f.evaluate(
            id(4),
            { ...parameters, openings: signatureOnly },
            [dependency],
            "shell",
            2,
          ),
        ),
      ).toMatchObject({ ok: false, diagnostic: { message: expect.stringContaining("Reselect") } })
      const opening = selected[0]
      if (!opening) throw new Error("The authored top opening must be present.")
      expect(
        matchValue(
          await f.evaluate(
            id(5),
            { ...parameters, openings: [{ ...opening, lineageToken: "history:missing" }] },
            [dependency],
            "shell",
            2,
          ),
        ),
      ).toMatchObject({ ok: false, diagnostic: { message: expect.stringContaining("Reselect") } })
      const closed = requireSuccess(
        await f.evaluate(id(6), { ...parameters, openings: [] }, [dependency], "shell", 2),
      )
      expect(closed.result.shape.volume).toBeCloseTo(6204, 6)
      expect(
        requireSuccess(await f.evaluate(id(1), { ...box, width: 26, height: 45 }, [], "box")).result
          .shape,
      ).toEqual(edited.result.shape)
    } finally {
      f.engine.disposeDocument(f.documentId)
      expect(f.engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
  it("creates inward and outward sharp-wall shells from exact opening faces, preserves the source and exports one body", async () => {
    const f = await kernelFixture()
    try {
      const source = requireSuccess(await f.evaluate(id(1), box, [], "box"))
      const dependency = { featureId: id(1), contentHash: source.contentHash, outputRole: "result" }
      const selected = openings(source.result, source.contentHash, [40])
      expect(selected).toHaveLength(1)
      for (const [index, direction, volume, min, max] of [
        [2, "inward", 4344, [-10, -15, 0], [10, 15, 40]],
        [3, "outward", 4864, [-11, -16, -1], [11, 16, 40]],
      ] as const) {
        const shell = requireSuccess(
          await f.evaluate(
            id(index),
            { thickness: 1, direction, sourceContentHash: source.contentHash, openings: selected },
            [dependency],
          ),
        )
        expect(shell.result.shape.valid).toBe(true)
        expect(shell.result.shape.solidCount).toBe(1)
        expect(shell.result.shape.volume).toBeCloseTo(volume, 6)
        expect(shell.result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
        for (const axis of [0, 1, 2] as const) {
          // OCCT offsets expand their conservative bounding box by the generated 0.001 mm tolerance.
          expect(Math.abs(shell.result.shape.bounds.min[axis] - min[axis])).toBeLessThanOrEqual(
            0.0011,
          )
          expect(Math.abs(shell.result.shape.bounds.max[axis] - max[axis])).toBeLessThanOrEqual(
            0.0011,
          )
        }
      }
      const through = requireSuccess(
        await f.evaluate(
          id(4),
          {
            thickness: 1,
            direction: "inward",
            sourceContentHash: source.contentHash,
            openings: openings(source.result, source.contentHash, [0, 40]),
          },
          [dependency],
        ),
      )
      expect(through.result.shape.volume).toBeCloseTo(3840, 6)
      expect(requireSuccess(await f.evaluate(id(1), box, [], "box")).result.shape).toEqual(
        source.result.shape,
      )
      for (const format of ["step", "stl"] as const) {
        const exported = await f.engine.exportDocument({
          documentId: f.documentId,
          features: [{ featureId: id(4), contentHash: through.contentHash, outputRole: "result" }],
          format,
        })
        expect(exported.bodyCount).toBe(1)
        expect(exported.file.byteLength).toBeGreaterThan(100)
      }
    } finally {
      f.engine.disposeDocument(f.documentId)
      expect(f.engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
  it("rejects stale source evidence, changed or duplicate openings, missing output roles and excessive thickness without mutating the source", async () => {
    const f = await kernelFixture()
    try {
      const source = requireSuccess(await f.evaluate(id(1), box, [], "box"))
      const dependency = { featureId: id(1), contentHash: source.contentHash, outputRole: "result" }
      const selected = openings(source.result, source.contentHash, [40])
      const parameters = {
        thickness: 1,
        direction: "inward",
        sourceContentHash: source.contentHash,
        openings: selected,
      }
      expect(
        matchValue(
          await f.evaluate(id(2), { ...parameters, sourceContentHash: "f".repeat(64) }, [
            dependency,
          ]),
        ),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-parameters",
          message: expect.stringContaining("Reselect"),
        },
      })
      const opening = selected[0]
      if (!opening) throw new Error("The top opening face must be present.")
      const changed = { ...opening, signature: { ...opening.signature, measure: 601 } }
      expect(
        matchValue(await f.evaluate(id(3), { ...parameters, openings: [changed] }, [dependency])),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-parameters",
          message: expect.stringContaining("Reselect"),
        },
      })
      expect(
        await f.evaluate(id(4), { ...parameters, openings: [...selected, ...selected] }, [
          dependency,
        ]),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-parameters" } })
      expect(
        await f.evaluate(
          id(5),
          {
            ...parameters,
            openings: selected.map((opening) => ({ ...opening, outputRole: "body.absent" })),
          },
          [{ ...dependency, outputRole: "body.absent" }],
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "missing-feature-dependency" } })
      expect(
        await f.evaluate(id(6), { ...parameters, thickness: 100 }, [dependency]),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
      expect(requireSuccess(await f.evaluate(id(1), box, [], "box")).result.shape).toEqual(
        source.result.shape,
      )
      const newer = requireSuccess(await f.evaluate(id(1), { ...box, height: 45 }, [], "box"))
      expect(
        matchValue(
          await f.evaluate(id(2), parameters, [{ ...dependency, contentHash: newer.contentHash }]),
        ),
      ).toMatchObject({ ok: false, diagnostic: { message: expect.stringContaining("Reselect") } })
      const repaired = requireSuccess(
        await f.evaluate(
          id(2),
          {
            ...parameters,
            sourceContentHash: newer.contentHash,
            openings: openings(newer.result, newer.contentHash, [45]),
          },
          [{ ...dependency, contentHash: newer.contentHash }],
        ),
      )
      expect(repaired.result.shape.volume).toBeCloseTo(4824, 6)
    } finally {
      f.engine.disposeDocument(f.documentId)
      expect(f.engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
})
