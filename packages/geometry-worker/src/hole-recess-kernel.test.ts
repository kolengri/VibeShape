import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "exact-hole-recesses"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3102"
const sourceHash = "a".repeat(64)
const resultHash = "b".repeat(64)
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const bytes = readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => engine.disposeDocument(documentId))
function request(
  typeId: string,
  schemaVersion: number,
  parameters: FeatureEvaluationInput["content"]["feature"]["parameters"],
  modifying = false,
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  return {
    documentId,
    featureId: modifying ? featureId : sourceId,
    contentHash: modifying ? resultHash : sourceHash,
    content: modifying
      ? {
          schemaVersion: 1,
          feature: {
            schemaVersion: 0,
            type: {
              moduleId: "org.vibeshape.core.part-design",
              moduleVersion: "0.1.0",
              typeId,
              schemaVersion,
            },
            parameters,
            inputs: [sourceHash],
            inputRoles: ["result"],
            references: [],
          },
          environment,
        }
      : {
          schemaVersion: 0,
          feature: {
            schemaVersion: 0,
            type: {
              moduleId: "org.vibeshape.core.part-design",
              moduleVersion: "0.1.0",
              typeId,
              schemaVersion,
            },
            parameters,
            inputs: [],
            references: [],
          },
          environment,
        },
    dependencies: modifying
      ? [{ featureId: sourceId, contentHash: sourceHash, outputRole: "result" }]
      : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
const base = {
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  centers: [[0, 0, 20]],
  diameter: 4,
  direction: "reverse",
  extent: "through-all",
}
describe("exact hole recess evaluation", () => {
  it.each([
    { kind: "counterbore", diameter: 8, depth: 3 },
    { kind: "countersink", diameter: 8, angle: Math.PI / 2 },
  ] as const)("cuts an exact $kind and retains the cached target", async (treatment) => {
    try {
      const source = await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.box", 1, {
          width: 20,
          depth: 20,
          height: 20,
          centered: false,
        }),
        vi.fn(),
      )
      if (!source.ok) throw new Error(source.diagnostic.message)
      const result = await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.hole", 3, { ...base, treatment }, true),
        vi.fn(),
      )
      if (!result.ok) throw new Error(result.diagnostic.message)
      const additional =
        treatment.kind === "counterbore"
          ? Math.PI * (4 ** 2 - 2 ** 2) * 3
          : (Math.PI * 2 * (4 ** 2 + 4 * 2 + 2 ** 2)) / 3 - Math.PI * 2 ** 2 * 2
      expect(result.result.shape.volume).toBeCloseTo(8000 - Math.PI * 2 ** 2 * 20 - additional, 5)
      expect(result.result.shape.solidCount).toBe(1)
      expect(result.result.shape.valid).toBe(true)
      const reread = await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.box", 1, {
          width: 20,
          depth: 20,
          height: 20,
          centered: false,
        }),
        vi.fn(),
      )
      expect(reread.ok && reread.result.shape.volume).toBeCloseTo(8000, 6)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it.each([
    { tipAngle: (118 * Math.PI) / 180, treatment: { kind: "simple" } },
    { tipAngle: Math.PI / 3, treatment: { kind: "simple" } },
    { tipAngle: (118 * Math.PI) / 180, treatment: { kind: "counterbore", diameter: 8, depth: 3 } },
    { tipAngle: Math.PI, treatment: { kind: "simple" } },
  ] as const)(
    "drills a blind $treatment.kind hole with a $tipAngle rad point beyond its shoulder",
    async ({ tipAngle, treatment }) => {
      try {
        const source = await engine.evaluateFeature(
          request("org.vibeshape.feature.part-design.box", 1, {
            width: 20,
            depth: 20,
            height: 20,
            centered: false,
          }),
          vi.fn(),
        )
        if (!source.ok) throw new Error(source.diagnostic.message)
        const result = await engine.evaluateFeature(
          request(
            "org.vibeshape.feature.part-design.hole",
            4,
            { ...base, extent: "blind", depth: 10, treatment, tipAngle },
            true,
          ),
          vi.fn(),
        )
        if (!result.ok) throw new Error(result.diagnostic.message)
        const radius = 2
        const tipHeight = tipAngle === Math.PI ? 0 : radius / Math.tan(tipAngle / 2)
        const counterbore =
          treatment.kind === "counterbore" ? Math.PI * (4 ** 2 - radius ** 2) * 3 : 0
        const removed =
          Math.PI * radius ** 2 * 10 + (Math.PI * radius ** 2 * tipHeight) / 3 + counterbore
        // Depth ends at the full-diameter shoulder; the cone of height r / tan(angle / 2) follows.
        expect(result.result.shape.volume).toBeCloseTo(8000 - removed, 5)
        expect(result.result.shape.solidCount).toBe(1)
        expect(result.result.shape.valid).toBe(true)
        expect(result.result.shape.bounds.min[2]).toBeCloseTo(0, 6)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
  )
  const tip118 = (118 * Math.PI) / 180
  const tipHeight118 = 2 / Math.tan(tip118 / 2)
  it.each([
    {
      name: "reverse countersunk",
      parameters: {
        ...base,
        extent: "blind",
        depth: 10,
        tipAngle: tip118,
        treatment: { kind: "countersink", diameter: 8, angle: Math.PI / 2 },
      },
      apexZ: 20 - 10 - tipHeight118,
      // The 90-degree countersink replaces a 2 mm cylinder segment with a 4→2 mm frustum.
      extra: (Math.PI * 2 * (4 ** 2 + 4 * 2 + 2 ** 2)) / 3 - Math.PI * 2 ** 2 * 2,
    },
    {
      name: "forward simple",
      parameters: {
        ...base,
        centers: [[0, 0, 0]],
        direction: "forward",
        extent: "blind",
        depth: 10,
        tipAngle: tip118,
        treatment: { kind: "simple" },
      },
      apexZ: 10 + tipHeight118,
      extra: 0,
    },
  ] as const)(
    "places the $name drill-point apex on the hole axis beyond the shoulder",
    async ({ parameters, apexZ, extra }) => {
      try {
        await engine.evaluateFeature(
          request("org.vibeshape.feature.part-design.box", 1, {
            width: 20,
            depth: 20,
            height: 20,
            centered: false,
          }),
          vi.fn(),
        )
        const result = await engine.evaluateFeature(
          request("org.vibeshape.feature.part-design.hole", 4, { ...parameters }, true),
          vi.fn(),
        )
        if (!result.ok) throw new Error(result.diagnostic.message)
        const removed = Math.PI * 4 * 10 + (Math.PI * 4 * tipHeight118) / 3 + extra
        expect(result.result.shape.volume).toBeCloseTo(8000 - removed, 5)
        const apexes = result.result.topologyCandidates.filter(
          ({ kind, signature }) =>
            kind === "vertex" &&
            Math.hypot(signature.centroid[0], signature.centroid[1]) < 1e-6 &&
            Math.abs(signature.centroid[2] - apexZ) < 1e-6,
        )
        expect(apexes).toHaveLength(1)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
  )
  it("treats a drill point shorter than the modeling tolerance as a flat bottom", async () => {
    try {
      await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.box", 1, {
          width: 20,
          depth: 20,
          height: 20,
          centered: false,
        }),
        vi.fn(),
      )
      // A 2 mm radius with this angle gives a 1e-7 mm cone, below the 1e-6 mm tolerance.
      const result = await engine.evaluateFeature(
        request(
          "org.vibeshape.feature.part-design.hole",
          4,
          {
            ...base,
            extent: "blind",
            depth: 10,
            tipAngle: Math.PI - 1e-7,
            treatment: { kind: "simple" },
          },
          true,
        ),
        vi.fn(),
      )
      if (!result.ok) throw new Error(result.diagnostic.message)
      expect(result.result.shape.valid).toBe(true)
      expect(result.result.shape.volume).toBeCloseTo(8000 - Math.PI * 4 * 10, 5)
      expect(
        result.result.topologyCandidates.some(
          ({ kind, signature }) =>
            kind === "vertex" && Math.hypot(signature.centroid[0], signature.centroid[1]) < 1e-6,
        ),
      ).toBe(false)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("rejects a version-4 drill point on a through-all hole", async () => {
    try {
      await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.box", 1, {
          width: 20,
          depth: 20,
          height: 20,
          centered: false,
        }),
        vi.fn(),
      )
      const result = await engine.evaluateFeature(
        request(
          "org.vibeshape.feature.part-design.hole",
          4,
          { ...base, treatment: { kind: "simple" }, tipAngle: Math.PI / 2 },
          true,
        ),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false })
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("rejects a recess outside the entry face and releases its failed result", async () => {
    await engine.evaluateFeature(
      request("org.vibeshape.feature.part-design.box", 1, {
        width: 20,
        depth: 20,
        height: 20,
        centered: false,
      }),
      vi.fn(),
    )
    try {
      const result = await engine.evaluateFeature(
        request(
          "org.vibeshape.feature.part-design.hole",
          3,
          {
            ...base,
            centers: [[0, 0, 25]],
            treatment: { kind: "counterbore", diameter: 8, depth: 2 },
          },
          true,
        ),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})
