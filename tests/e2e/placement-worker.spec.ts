import { resolve } from "node:path"
import { expect, test } from "./fixtures"

const source = (path: string) => `/@fs${resolve(path)}`

test("places exact solids with rigid world transforms, dependent rebuilds and owned cleanup", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  const evidence = await page.evaluate(
    async (paths) => {
      const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
      const protocol: typeof import("../../packages/protocol/src/index") = await import(
        paths.protocol
      )
      type Terminal = import("../../packages/protocol/src/index").GeometryTerminalResponse
      type Dependency = import("../../packages/protocol/src/index").FeatureEvaluationDependency
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
      const documentId = "placement-worker-fixture"
      const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
      let client = worker.createGeometryWorkerClient()
      const envelope = () => worker.createGeometryRequestEnvelope(documentId, 1)
      try {
        const initialized = await client.request({ ...envelope(), type: "initializeEngine" })
        if (initialized.type !== "initialized") throw new Error("Worker did not initialize.")
        const environment = initialized.engine.featureContentEnvironment
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
          type = domain.placementFeatureType.type,
        ) {
          const named = dependencies.length > 0
          const content = protocol.featureContentIdentitySchema.parse({
            schemaVersion: named ? 1 : 0,
            environment,
            feature: {
              schemaVersion: 0,
              type,
              parameters,
              inputs: dependencies.map(({ contentHash }) => contentHash),
              ...(named ? { inputRoles: dependencies.map(({ outputRole }) => outputRole) } : {}),
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
        const compact = (result: Extract<Terminal, { type: "featureEvaluated" }>) => {
          if (!result.bodies)
            throw new Error("Placement evidence requires exact named body outputs.")
          return {
            shape: result.shape,
            cache: result.cache,
            contentHash: result.contentHash,
            bodies: result.bodies.map(({ outputRole, shape }) => ({ outputRole, shape })),
          }
        }
        const boxParameters = { width: 10, depth: 20, height: 30, centered: false }
        const placement = { translation: [100, -40, 5], rotation: [0, 0, Math.PI / 2] }
        const dependency = (
          featureId: string,
          contentHash: string,
          outputRole = "result",
        ): Dependency[] => [{ featureId, contentHash, outputRole }]
        const sourceSolid = await evaluate(id(1), boxParameters, [], domain.boxFeatureType.type)
        const placed = await evaluate(id(2), placement, dependency(id(1), sourceSolid.contentHash))
        const cached = await evaluate(id(2), placement, dependency(id(1), sourceSolid.contentHash))
        const allAxes = await evaluate(
          id(4),
          { translation: [10, 20, 30], rotation: [Math.PI / 2, Math.PI / 2, Math.PI / 2] },
          dependency(id(1), sourceSolid.contentHash),
        )
        const dependentParameters = { translation: [0, 0, 20], rotation: [0, 0, 0] }
        const dependent = await evaluate(
          id(3),
          dependentParameters,
          dependency(id(2), placed.contentHash),
        )
        const sourceAfter = await evaluate(id(1), boxParameters, [], domain.boxFeatureType.type)
        const beforeFailures = await client.request({ ...envelope(), type: "healthCheck" })
        const rejected: { label: string; code: string }[] = []
        async function reject(label: string, parameters: unknown, dependencies: Dependency[]) {
          try {
            await evaluate(id(9), parameters, dependencies)
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
        await reject(
          "missing-body",
          placement,
          dependency(id(1), sourceSolid.contentHash, "body.unavailable"),
        )
        await reject("unavailable-feature", placement, dependency(id(99), sourceSolid.contentHash))
        await reject(
          "world-bound",
          { translation: [100_000, 0, 0], rotation: [0, 0, 0] },
          dependency(id(1), sourceSolid.contentHash),
        )
        const afterFailures = await client.request({ ...envelope(), type: "healthCheck" })
        const editedSource = await evaluate(
          id(1),
          { ...boxParameters, width: 14 },
          [],
          domain.boxFeatureType.type,
        )
        await reject("stale-source", placement, dependency(id(1), sourceSolid.contentHash))
        const rebuilt = await evaluate(
          id(2),
          placement,
          dependency(id(1), editedSource.contentHash),
        )
        const rebuiltDependent = await evaluate(
          id(3),
          dependentParameters,
          dependency(id(2), rebuilt.contentHash),
        )
        const afterRebuild = await client.request({ ...envelope(), type: "healthCheck" })
        const disposal = await client.request({ ...envelope(), type: "disposeDocument" })
        client.terminate()
        client = worker.createGeometryWorkerClient()
        await client.request({ ...envelope(), type: "initializeEngine" })
        const restartedSource = await evaluate(id(1), boxParameters, [], domain.boxFeatureType.type)
        const restarted = await evaluate(
          id(2),
          placement,
          dependency(id(1), restartedSource.contentHash),
        )
        const restartedDisposal = await client.request({ ...envelope(), type: "disposeDocument" })
        return {
          source: compact(sourceSolid),
          placed: compact(placed),
          cached: compact(cached),
          allAxes: compact(allAxes),
          dependent: compact(dependent),
          sourceAfter: compact(sourceAfter),
          rebuilt: compact(rebuilt),
          rebuiltDependent: compact(rebuiltDependent),
          restarted: compact(restarted),
          beforeFailures,
          afterFailures,
          afterRebuild,
          disposal,
          restartedDisposal,
          rejected,
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
  const solid = (
    result: typeof evidence.placed,
    volume: number,
    min: readonly number[],
    max: readonly number[],
  ) => {
    expect(result.shape.solidCount).toBe(1)
    expect(result.shape.volume).toBeCloseTo(volume, 5)
    expect(result.bodies.map(({ outputRole }) => outputRole)).toEqual(["result"])
    for (const [index, expected] of min.entries())
      expect(result.shape.bounds.min[index]).toBeCloseTo(expected, 5)
    for (const [index, expected] of max.entries())
      expect(result.shape.bounds.max[index]).toBeCloseTo(expected, 5)
  }
  solid(evidence.source, 6000, [-5, -10, 0], [5, 10, 30])
  solid(evidence.placed, 6000, [90, -45, 5], [110, -35, 35])
  // With each angle 90 degrees, Rz * Ry * Rx maps (x,y,z) to (z,y,-x).
  solid(evidence.allAxes, 6000, [10, 10, 25], [40, 30, 35])
  solid(evidence.dependent, 6000, [90, -45, 25], [110, -35, 55])
  solid(evidence.rebuilt, 8400, [90, -47, 5], [110, -33, 35])
  solid(evidence.rebuiltDependent, 8400, [90, -47, 25], [110, -33, 55])
  expect(evidence.cached.cache.brepHit).toBe(true)
  expect(evidence.sourceAfter.shape).toEqual(evidence.source.shape)
  expect(evidence.rebuilt.contentHash).not.toBe(evidence.placed.contentHash)
  expect(evidence.rebuiltDependent.contentHash).not.toBe(evidence.dependent.contentHash)
  expect(evidence.restarted.shape).toEqual(evidence.placed.shape)
  expect(evidence.restarted.cache.brepHit).toBe(false)
  expect(evidence.rejected).toEqual([
    { label: "missing-body", code: "missing-feature-dependency" },
    { label: "unavailable-feature", code: "missing-feature-dependency" },
    { label: "world-bound", code: "invalid-feature-geometry" },
    { label: "stale-source", code: "missing-feature-dependency" },
  ])
  expect(evidence.beforeFailures).toMatchObject({ type: "health", ownedShapeCount: 4 })
  expect(evidence.afterFailures).toMatchObject({ type: "health", ownedShapeCount: 4 })
  expect(evidence.afterRebuild).toMatchObject({ type: "health", ownedShapeCount: 4 })
  expect(evidence.disposal).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
  expect(evidence.restartedDisposal).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
})

test("rebuilds the document placement chain after authored edits and blocks suppressed or unavailable sources", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  const evidence = await page.evaluate(
    async (paths) => {
      const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
      type Terminal = import("../../packages/protocol/src/index").DocumentWorkerTerminalResponse
      const worker: {
        createDocumentWorkerClient(): {
          request(
            input: import("../../packages/protocol/src/index").DocumentWorkerRequest,
          ): Promise<Terminal>
          terminate(): void
        }
        createDocumentRequestEnvelope(
          documentId: string,
          generation: number,
          revision?: number,
        ): {
          protocolVersion: 22
          requestId: string
          documentId: string
          revision: number
          generation: number
        }
      } = await import(paths.worker)
      const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
      const box = (width = 10, suppressed = false) => ({
        schemaVersion: 0 as const,
        id: id(1),
        type: domain.boxFeatureType.type,
        parameters: {
          width: domain.createLengthQuantity(width),
          depth: domain.createLengthQuantity(20),
          height: domain.createLengthQuantity(30),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed,
      })
      const placement = (
        featureId: string,
        sourceId: string,
        outputRole = "result",
        x = 100,
        z = 5,
        turn = Math.PI / 2,
      ) => ({
        schemaVersion: 0 as const,
        id: featureId,
        type: domain.placementFeatureType.type,
        parameters: {
          targetBody: { schemaVersion: 0, featureId: sourceId, outputRole },
          translation: {
            x: domain.createLengthQuantity(x),
            y: domain.createLengthQuantity(-40),
            z: domain.createLengthQuantity(z),
          },
          rotation: {
            x: domain.createAngleQuantity(0),
            y: domain.createAngleQuantity(0),
            z: domain.createAngleQuantity(turn),
          },
        },
        dependencies: [sourceId],
        references: [],
        suppressed: false,
      })
      const client = worker.createDocumentWorkerClient()
      let revision = 0
      async function rebuild(features: ReturnType<typeof box | typeof placement>[]) {
        revision += 1
        const result = await client.request({
          ...worker.createDocumentRequestEnvelope(id(99), 1, revision),
          type: "rebuildDocument",
          document: {
            schemaVersion: 0,
            id: id(99),
            revision,
            name: "Placement rebuild fixture",
            displayUnits: { length: "mm", angle: "deg" },
            variables: [],
            sketches: [],
            features,
            createdAt: "2026-10-03T00:00:00Z",
            updatedAt: "2026-10-03T00:00:00Z",
          },
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        })
        if (result.type !== "documentRebuilt") throw new Error(`Unexpected ${result.type}.`)
        return {
          evaluation: result.evaluation,
          geometry: result.geometry.map(({ featureId, contentHash, geometry }) => ({
            featureId,
            contentHash,
            shape: geometry.shape,
          })),
        }
      }
      try {
        const chain = [placement(id(2), id(1)), placement(id(3), id(2), "result", 0, 20, 0)]
        const initial = await rebuild([box(), ...chain])
        const reused = await rebuild([box(), ...chain])
        const edited = await rebuild([box(14), ...chain])
        const suppressed = await rebuild([box(14, true), ...chain])
        const restored = await rebuild([box(14), ...chain])
        const unavailable = await rebuild([
          box(14),
          placement(id(2), id(1), "body.unavailable"),
          chain[1] ?? placement(id(3), id(2)),
        ])
        const disposal = await client.request({
          ...worker.createDocumentRequestEnvelope(id(99), 1, revision),
          type: "disposeDocument",
        })
        return {
          initial,
          reused,
          edited,
          suppressed,
          restored,
          unavailable,
          disposal,
          ids: [id(1), id(2), id(3)],
        }
      } finally {
        client.terminate()
      }
    },
    {
      domain: source("packages/domain/src/index.ts"),
      worker: source("packages/document-worker/src/client.ts"),
    },
  )
  for (const result of [evidence.initial, evidence.edited, evidence.restored]) {
    expect(result.evaluation.records.map(({ status }) => status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ])
    expect(result.geometry.map(({ featureId }) => featureId)).toEqual(evidence.ids)
  }
  expect(evidence.reused.evaluation.reusedFeatureIds).toEqual(evidence.ids)
  expect(evidence.edited.evaluation.evaluatedFeatureIds).toEqual(evidence.ids)
  for (const featureId of evidence.ids) {
    const initial = evidence.initial.geometry.find((entry) => entry.featureId === featureId)
    const edited = evidence.edited.geometry.find((entry) => entry.featureId === featureId)
    expect(initial?.shape.volume).toBeCloseTo(6000, 5)
    expect(edited?.shape.volume).toBeCloseTo(8400, 5)
    expect(edited?.contentHash).not.toBe(initial?.contentHash)
  }
  expect(evidence.suppressed.evaluation.records.map(({ status }) => status)).toEqual([
    "suppressed",
    "blocked",
    "blocked",
  ])
  expect(evidence.suppressed.geometry).toHaveLength(0)
  expect(evidence.unavailable.evaluation.records.map(({ status }) => status)).toEqual([
    "succeeded",
    "failed",
    "blocked",
  ])
  expect(evidence.unavailable.geometry.map(({ featureId }) => featureId)).toEqual([evidence.ids[0]])
  expect(evidence.disposal).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
})
