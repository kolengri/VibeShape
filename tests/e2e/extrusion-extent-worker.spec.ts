import { resolve } from "node:path"
import { expect, test } from "./fixtures"

const source = (path: string) => `/@fs${resolve(path)}`

test("evaluates independent extrusion depths with exact worker geometry and stable cap roles", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const evidence = await page.evaluate(
    async (paths) => {
      const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
      const protocol: typeof import("../../packages/protocol/src/index") = await import(
        paths.protocol
      )
      type Terminal = import("../../packages/protocol/src/index").GeometryTerminalResponse
      const worker: {
        createGeometryWorkerClient(): {
          request(
            input: import("../../packages/protocol/src/index").GeometryWorkerRequest,
          ): Promise<Terminal>
          terminate(): void
        }
        createGeometryRequestEnvelope(
          documentId: string,
          generation: number,
        ): import("../../packages/protocol/src/index").GeometryRequestEnvelope
        GeometryWorkerRequestError: new (
          message: string,
          response?: Terminal,
        ) => Error & { response?: Terminal }
      } = await import(paths.worker)
      type FeatureResponse = Extract<
        import("../../packages/protocol/src/index").GeometryWorkerResponse,
        { type: "featureEvaluated" }
      >
      type Dependency = import("../../packages/protocol/src/index").FeatureEvaluationDependency
      const documentId = "extrusion-extent-worker-fixture"
      const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
      let client = worker.createGeometryWorkerClient()
      const envelope = () => worker.createGeometryRequestEnvelope(documentId, 1)
      try {
        const initialized = await client.request({ ...envelope(), type: "initializeEngine" })
        if (initialized.type !== "initialized") throw new Error("Worker did not initialize.")
        const environment = initialized.engine.featureContentEnvironment
        const frame = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
        function rectangle(offset: number, firstId: number) {
          const points = [
            [offset - 5, -10],
            [offset + 5, -10],
            [offset + 5, 10],
            [offset - 5, 10],
          ]
          return {
            outer: {
              sourceEntityIds: points.map((_, index) => id(firstId + index)),
              segments: points.map((start, index) => ({
                type: "line",
                entityId: id(firstId + index),
                startPointId: id(firstId + 4 + index),
                endPointId: id(firstId + 4 + ((index + 1) % 4)),
                start,
                end: points[(index + 1) % 4],
              })),
            },
            holes: [],
          }
        }
        const profile = rectangle(0, 100)
        const base = {
          sketchId: id(90),
          frame,
          profiles: [profile],
          distance: 10,
          symmetric: false,
          reversed: false,
          secondDistance: 3,
          operation: "new",
        }
        const hash = async (
          content: import("../../packages/protocol/src/index").FeatureContentIdentity,
        ) => {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(protocol.serializeFeatureContentIdentity(content)),
          )
          return Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("")
        }
        async function evaluate(
          featureId: string,
          parameters: unknown,
          dependencies: readonly Dependency[] = [],
          type = domain.extrusionFeatureTypeV5.type,
        ) {
          const content = protocol.featureContentIdentitySchema.parse({
            schemaVersion: 0,
            environment,
            feature: {
              schemaVersion: 0,
              type,
              parameters,
              inputs: dependencies.map(({ contentHash }) => contentHash),
              references: [],
            },
          })
          const result = await client.request({
            ...envelope(),
            type: "evaluateFeature",
            featureId,
            content,
            contentHash: await hash(content),
            dependencies: [...dependencies],
            mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
          })
          if (result.type !== "featureEvaluated")
            throw new Error(`Unexpected response ${result.type}.`)
          return result
        }
        const compact = (result: FeatureResponse) => ({
          shape: result.shape,
          cache: result.cache,
          caps: result.topologyCandidates
            .filter(
              ({ semanticRole }) =>
                semanticRole === "extrusion.cap.start" || semanticRole === "extrusion.cap.end",
            )
            .map(({ semanticRole, signature }) => ({
              role: semanticRole,
              centroid: signature.centroid,
            })),
        })
        const forward = await evaluate(id(1), base)
        const cache = await evaluate(id(1), base)
        const reversed = await evaluate(id(2), { ...base, reversed: true })
        const oneSidedReverse = await evaluate(id(3), {
          ...base,
          reversed: true,
          secondDistance: null,
        })
        const symmetric = await evaluate(id(4), {
          ...base,
          symmetric: true,
          distance: 18,
          secondDistance: null,
        })
        const legacySymmetric = await evaluate(
          id(5),
          {
            sketchId: base.sketchId,
            frame,
            ...profile,
            distance: 18,
            symmetric: true,
            operation: "new",
          },
          [],
          domain.extrusionFeatureType.type,
        )
        const multi = await evaluate(id(6), { ...base, profiles: [profile, rectangle(30, 200)] })
        const target = await evaluate(
          id(7),
          { width: 10, depth: 20, height: 20, centered: false },
          [],
          domain.boxFeatureType.type,
        )
        const dependency = [{ featureId: id(7), contentHash: target.contentHash }]
        const modified = []
        for (const [index, operation] of ["add", "remove", "intersect"].entries()) {
          const result = await evaluate(id(8 + index), { ...base, operation }, dependency)
          modified.push({ operation, ...compact(result) })
        }
        const rebuilt = await evaluate(id(1), { ...base, distance: 12, secondDistance: 4 })
        const rebuiltCache = await evaluate(id(1), { ...base, distance: 12, secondDistance: 4 })
        const rejected = []
        for (const [label, parameters] of [
          ["zero-depth", { ...base, secondDistance: 0 }],
          ["span-overflow", { ...base, distance: 99_999 }],
          ["symmetric-second-depth", { ...base, symmetric: true }],
          ["missing-target", { ...base, operation: "remove" }],
          ["disjoint-add", { ...base, profiles: [rectangle(30, 200)], operation: "add" }],
        ] as const) {
          try {
            await evaluate(id(30), parameters, label === "disjoint-add" ? dependency : [])
            throw new Error(`Invalid fixture ${label} unexpectedly succeeded.`)
          } catch (error) {
            if (
              !(error instanceof worker.GeometryWorkerRequestError) ||
              error.response?.type !== "failure"
            )
              throw error
            rejected.push({ label, code: error.response.diagnostic.code })
          }
        }
        const sourceAfter = await evaluate(
          id(7),
          { width: 10, depth: 20, height: 20, centered: false },
          [],
          domain.boxFeatureType.type,
        )
        const disposal = await client.request({ ...envelope(), type: "disposeDocument" })
        client.terminate()
        client = worker.createGeometryWorkerClient()
        await client.request({ ...envelope(), type: "initializeEngine" })
        const restarted = await evaluate(id(1), base)
        const restartedDisposal = await client.request({ ...envelope(), type: "disposeDocument" })
        return {
          engine: initialized.engine,
          forward: compact(forward),
          cache: compact(cache),
          reversed: compact(reversed),
          oneSidedReverse: compact(oneSidedReverse),
          symmetric: compact(symmetric),
          legacySymmetric: compact(legacySymmetric),
          multi: compact(multi),
          modified,
          rebuilt: compact(rebuilt),
          rebuiltCache: compact(rebuiltCache),
          sourceAfter: compact(sourceAfter),
          restarted: compact(restarted),
          rejected,
          disposal,
          restartedDisposal,
        }
      } finally {
        client.terminate()
      }
    },
    {
      domain: source("packages/domain/src/index.ts"),
      protocol: source("packages/protocol/src/index.ts"),
      worker: source("packages/geometry-worker/src/client.ts"),
    },
  )

  const expectSolid = (
    result: typeof evidence.forward | undefined,
    volume: number,
    minZ: number,
    maxZ: number,
    solidCount = 1,
  ) => {
    if (!result) throw new Error("Expected feature geometry evidence.")
    expect(result.shape.valid).toBe(true)
    expect(result.shape.solidCount).toBe(solidCount)
    expect(result.shape.volume).toBeCloseTo(volume, 5)
    expect(result.shape.bounds.min[2]).toBeCloseTo(minZ, 6)
    expect(result.shape.bounds.max[2]).toBeCloseTo(maxZ, 6)
  }
  expectSolid(evidence.forward, 2600, -3, 10)
  expectSolid(evidence.reversed, 2600, -10, 3)
  expectSolid(evidence.oneSidedReverse, 2000, -10, 0)
  expectSolid(evidence.symmetric, 3600, -9, 9)
  expectSolid(evidence.legacySymmetric, 3600, -9, 9)
  expectSolid(evidence.multi, 5200, -3, 10, 2)
  expectSolid(evidence.modified[0], 4600, -3, 20)
  expectSolid(evidence.modified[1], 2000, 10, 20)
  expectSolid(evidence.modified[2], 2000, 0, 10)
  expectSolid(evidence.rebuilt, 3200, -4, 12)
  expectSolid(evidence.sourceAfter, 4000, 0, 20)
  expectSolid(evidence.restarted, 2600, -3, 10)
  for (const [result, start, end] of [
    [evidence.forward, -3, 10],
    [evidence.reversed, -10, 3],
    [evidence.symmetric, -9, 9],
    [evidence.rebuilt, -4, 12],
  ] as const) {
    expect(result.caps).toHaveLength(2)
    expect(result.caps.find(({ role }) => role === "extrusion.cap.start")?.centroid[2]).toBeCloseTo(
      start,
      6,
    )
    expect(result.caps.find(({ role }) => role === "extrusion.cap.end")?.centroid[2]).toBeCloseTo(
      end,
      6,
    )
  }
  expect(evidence.cache.cache.brepHit).toBe(true)
  expect(evidence.rebuilt.cache.brepHit).toBe(false)
  expect(evidence.rebuiltCache.cache.brepHit).toBe(true)
  expect(evidence.restarted.cache.brepHit).toBe(false)
  expect(evidence.rejected).toEqual([
    { label: "zero-depth", code: "invalid-feature-parameters" },
    { label: "span-overflow", code: "invalid-feature-parameters" },
    { label: "symmetric-second-depth", code: "invalid-feature-parameters" },
    { label: "missing-target", code: "invalid-feature-parameters" },
    { label: "disjoint-add", code: "invalid-feature-geometry" },
  ])
  expect(evidence.disposal.type).toBe("documentDisposed")
  expect(evidence.restartedDisposal.type).toBe("documentDisposed")
  if (
    evidence.disposal.type !== "documentDisposed" ||
    evidence.restartedDisposal.type !== "documentDisposed"
  )
    throw new Error("Worker disposal evidence missing.")
  expect(evidence.disposal.ownedShapeCount).toBe(0)
  expect(evidence.restartedDisposal.ownedShapeCount).toBe(0)
  await test.info().attach("extrusion-extent-worker-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  })
})
