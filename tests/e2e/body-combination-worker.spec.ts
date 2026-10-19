import { resolve } from "node:path"
import { expect, test } from "./fixtures"

const source = (path: string) => `/@fs${resolve(path)}`

test("keeps Compound slots exact and separate, fuses Union explicitly, and preserves isolated inputs through failure and rebuild", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
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
      const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
      const roles = [`body.${id(700)}`, `body.${id(701)}`]
      const documentId = "body-combination-worker-fixture"
      let client = worker.createGeometryWorkerClient()
      const envelope = (namespace = documentId) =>
        worker.createGeometryRequestEnvelope(namespace, 1)
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
          type: import("../../packages/protocol/src/index").FeatureContentIdentity["feature"]["type"],
          parameters: unknown,
          dependencies: Dependency[] = [],
          namespace = documentId,
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
            ...envelope(namespace),
            type: "evaluateFeature",
            featureId,
            content,
            contentHash: await hash(content),
            dependencies,
            mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
          })
          if (result.type !== "featureEvaluated" || !result.bodies)
            throw new Error("Expected exact named geometry output.")
          return result
        }
        const dependency = (
          featureId: string,
          contentHash: string,
          outputRole = "result",
        ): Dependency => ({ featureId, contentHash, outputRole })
        const compact = (result: Extract<Terminal, { type: "featureEvaluated" }>) => {
          if (!result.bodies) throw new Error("Exact body catalogs are required.")
          return {
            featureId: result.featureId,
            contentHash: result.contentHash,
            shape: result.shape,
            cache: result.cache,
            bodies: result.bodies.map(({ outputRole, shape, mesh, topologyCandidates }) => ({
              outputRole,
              shape,
              triangles: mesh.indices.length / 3,
              topologyCount: topologyCandidates.length,
            })),
          }
        }
        const boxParameters = { width: 10, depth: 20, height: 30, centered: false }
        const a = await evaluate(id(1), domain.boxFeatureType.type, boxParameters)
        const b = await evaluate(id(2), domain.boxFeatureType.type, {
          ...boxParameters,
          origin: [5, 0, 0],
        })
        const inputs = [dependency(id(1), a.contentHash), dependency(id(2), b.contentHash)]
        const compound = await evaluate(
          id(3),
          domain.compoundFeatureType.type,
          { outputRoles: roles },
          inputs,
        )
        const union = await evaluate(id(4), domain.unionFeatureType.type, {}, inputs)
        const move = { translation: [0, 100, 0], rotation: [0, 0, 0] }
        const first = await evaluate(id(5), domain.placementFeatureType.type, move, [
          dependency(id(3), compound.contentHash, roles[0]),
        ])
        const second = await evaluate(id(6), domain.placementFeatureType.type, move, [
          dependency(id(3), compound.contentHash, roles[1]),
        ])
        const reordered = await evaluate(
          id(3),
          domain.compoundFeatureType.type,
          { outputRoles: [...roles].reverse() },
          [...inputs].reverse(),
        )
        const reorderedCache = await evaluate(
          id(3),
          domain.compoundFeatureType.type,
          { outputRoles: [...roles].reverse() },
          [...inputs].reverse(),
        )
        const inputAfter = [
          await evaluate(id(1), domain.boxFeatureType.type, boxParameters),
          await evaluate(id(2), domain.boxFeatureType.type, {
            ...boxParameters,
            origin: [5, 0, 0],
          }),
        ]
        const healthBefore = await client.request({ ...envelope(), type: "healthCheck" })
        const rejected: { label: string; code: string }[] = []
        async function reject(
          label: string,
          type: typeof domain.unionFeatureType.type,
          parameters: unknown,
          dependencies: Dependency[],
          namespace = documentId,
          featureId = id(90),
        ) {
          try {
            await evaluate(featureId, type, parameters, dependencies, namespace)
            throw new Error(`${label} unexpectedly succeeded.`)
          } catch (error) {
            if (
              !(error instanceof worker.GeometryWorkerRequestError) ||
              error.response?.type !== "failure"
            )
              throw error
            rejected.push({ label, code: error.response.diagnostic.code })
          }
        }
        await reject("missing-slot", domain.placementFeatureType.type, move, [
          dependency(id(3), reordered.contentHash, `body.${id(799)}`),
        ])
        await reject(
          "foreign-document",
          domain.unionFeatureType.type,
          {},
          inputs,
          "body-combination-other-document",
        )
        await reject("missing-producer", domain.unionFeatureType.type, {}, [
          inputs[0] ?? dependency(id(1), a.contentHash),
          dependency(id(99), b.contentHash),
        ])
        await reject("unsupported-intent", domain.unionFeatureType.type, { scale: 2 }, inputs)
        await reject(
          "incomplete-slots",
          domain.compoundFeatureType.type,
          { outputRoles: roles.slice(0, 1) },
          inputs,
        )
        const healthAfter = await client.request({ ...envelope(), type: "healthCheck" })
        const changedA = await evaluate(id(1), domain.boxFeatureType.type, {
          ...boxParameters,
          width: 14,
        })
        await reject(
          "stale-dependency-before-cache",
          domain.compoundFeatureType.type,
          { outputRoles: [...roles].reverse() },
          [...inputs].reverse(),
          documentId,
          id(3),
        )
        const changedInputs = [
          dependency(id(1), changedA.contentHash),
          dependency(id(2), b.contentHash),
        ]
        const rebuilt = await evaluate(
          id(3),
          domain.compoundFeatureType.type,
          { outputRoles: roles },
          changedInputs,
        )
        const rebuiltFirst = await evaluate(id(5), domain.placementFeatureType.type, move, [
          dependency(id(3), rebuilt.contentHash, roles[0]),
        ])
        const rebuiltUnion = await evaluate(id(4), domain.unionFeatureType.type, {}, changedInputs)
        const movedB = await evaluate(id(2), domain.boxFeatureType.type, {
          ...boxParameters,
          origin: [30, 0, 0],
        })
        const disjointInputs = [
          dependency(id(1), changedA.contentHash),
          dependency(id(2), movedB.contentHash),
        ]
        const beforeDisjoint = await client.request({ ...envelope(), type: "healthCheck" })
        for (let index = 0; index < 4; index += 1)
          await reject(`disjoint-${index}`, domain.unionFeatureType.type, {}, disjointInputs)
        const afterDisjoint = await client.request({ ...envelope(), type: "healthCheck" })
        const touchingB = await evaluate(id(2), domain.boxFeatureType.type, {
          ...boxParameters,
          origin: [12, 0, 0],
        })
        const recovered = await evaluate(id(4), domain.unionFeatureType.type, {}, [
          dependency(id(1), changedA.contentHash),
          dependency(id(2), touchingB.contentHash),
        ])
        const manyInputs: Dependency[] = []
        const manyRoles: string[] = []
        for (let index = 0; index < 8; index += 1) {
          const body = await evaluate(id(20 + index), domain.boxFeatureType.type, {
            width: 2,
            depth: 3,
            height: 4,
            centered: false,
            origin: [2 * index, 0, 0],
          })
          manyInputs.push(dependency(id(20 + index), body.contentHash))
          manyRoles.push(`body.${id(720 + index)}`)
        }
        const eightBodyCompound = await evaluate(
          id(30),
          domain.compoundFeatureType.type,
          { outputRoles: manyRoles },
          manyInputs,
        )
        const eightBodyUnion = await evaluate(id(31), domain.unionFeatureType.type, {}, manyInputs)
        const disposal = await client.request({ ...envelope(), type: "disposeDocument" })
        client.terminate()
        client = worker.createGeometryWorkerClient()
        await client.request({ ...envelope(), type: "initializeEngine" })
        const restartA = await evaluate(id(1), domain.boxFeatureType.type, boxParameters)
        const restartB = await evaluate(id(2), domain.boxFeatureType.type, {
          ...boxParameters,
          origin: [5, 0, 0],
        })
        const restarted = await evaluate(
          id(3),
          domain.compoundFeatureType.type,
          { outputRoles: roles },
          [dependency(id(1), restartA.contentHash), dependency(id(2), restartB.contentHash)],
        )
        const restartDisposal = await client.request({ ...envelope(), type: "disposeDocument" })
        return {
          engine: initialized.engine,
          roles,
          source: [compact(a), compact(b)],
          inputAfter: inputAfter.map(compact),
          compound: compact(compound),
          union: compact(union),
          first: compact(first),
          second: compact(second),
          reordered: compact(reordered),
          reorderedCache: compact(reorderedCache),
          rebuilt: compact(rebuilt),
          rebuiltFirst: compact(rebuiltFirst),
          rebuiltUnion: compact(rebuiltUnion),
          recovered: compact(recovered),
          eightBodyCompound: compact(eightBodyCompound),
          eightBodyUnion: compact(eightBodyUnion),
          restarted: compact(restarted),
          healthBefore,
          healthAfter,
          beforeDisjoint,
          afterDisjoint,
          disposal,
          restartDisposal,
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
  await test.info().attach("body-combination-native-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  })
  expect(evidence.compound.shape).toMatchObject({ valid: true, solidCount: 2 })
  expect(evidence.compound.shape.volume).toBeCloseTo(12000, 5)
  expect(evidence.compound.bodies.map(({ outputRole }) => outputRole)).toEqual(evidence.roles)
  for (const body of evidence.compound.bodies) {
    expect(body.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(body.shape.volume).toBeCloseTo(6000, 5)
    expect(body.triangles).toBeGreaterThan(0)
    expect(body.topologyCount).toBeGreaterThan(0)
  }
  expect(evidence.union.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(evidence.union.shape.volume).toBeCloseTo(9000, 5)
  expect(evidence.union.bodies.map(({ outputRole }) => outputRole)).toEqual(["result"])
  expect(evidence.first.contentHash).not.toBe(evidence.second.contentHash)
  expect(evidence.first.shape.bounds.min[0]).toBeCloseTo(-5, 5)
  expect(evidence.second.shape.bounds.min[0]).toBeCloseTo(0, 5)
  expect(evidence.first.shape.bounds.min[1]).toBeCloseTo(90, 5)
  expect(evidence.reordered.bodies.map(({ outputRole }) => outputRole)).toEqual(
    [...evidence.roles].reverse(),
  )
  for (const original of evidence.compound.bodies)
    expect(
      evidence.reordered.bodies.find(({ outputRole }) => outputRole === original.outputRole)?.shape,
    ).toEqual(original.shape)
  expect(evidence.reorderedCache.cache.brepHit).toBe(true)
  expect(evidence.inputAfter.map(({ shape }) => shape)).toEqual(
    evidence.source.map(({ shape }) => shape),
  )
  expect(evidence.rebuilt.shape.volume).toBeCloseTo(14400, 5)
  expect(evidence.rebuiltFirst.shape.volume).toBeCloseTo(8400, 5)
  expect(evidence.rebuilt.bodies[1]?.shape).toEqual(evidence.compound.bodies[1]?.shape)
  expect(evidence.rebuiltUnion.shape.volume).toBeCloseTo(10200, 5)
  expect(evidence.recovered.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(evidence.recovered.shape.volume).toBeCloseTo(14400, 5)
  expect(evidence.eightBodyCompound.shape).toMatchObject({ valid: true, solidCount: 8 })
  expect(evidence.eightBodyCompound.bodies).toHaveLength(8)
  expect(evidence.eightBodyCompound.shape.volume).toBeCloseTo(192, 5)
  expect(evidence.eightBodyUnion.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(evidence.eightBodyUnion.shape.volume).toBeCloseTo(192, 5)
  expect(evidence.rejected).toEqual([
    { label: "missing-slot", code: "missing-feature-dependency" },
    { label: "foreign-document", code: "missing-feature-dependency" },
    { label: "missing-producer", code: "missing-feature-dependency" },
    { label: "unsupported-intent", code: "invalid-feature-parameters" },
    { label: "incomplete-slots", code: "invalid-feature-parameters" },
    { label: "stale-dependency-before-cache", code: "missing-feature-dependency" },
    ...Array.from({ length: 4 }, (_, index) => ({
      label: `disjoint-${index}`,
      code: "invalid-feature-geometry",
    })),
  ])
  for (const health of [
    evidence.healthBefore,
    evidence.healthAfter,
    evidence.beforeDisjoint,
    evidence.afterDisjoint,
  ])
    expect(health).toMatchObject({ type: "health", ownedShapeCount: 8 })
  expect(evidence.restarted.shape).toEqual(evidence.compound.shape)
  expect(evidence.restarted.cache.brepHit).toBe(false)
  expect(evidence.disposal).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
  expect(evidence.restartDisposal).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
})

test("rebuilds Compound slots through edits, suppression and role removal without consuming siblings", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  const evidence = await page.evaluate(
    async (paths) => {
      const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
      const protocol: typeof import("../../packages/protocol/src/index") = await import(
        paths.protocol
      )
      type Terminal = import("../../packages/protocol/src/index").DocumentWorkerTerminalResponse
      type Request = import("../../packages/protocol/src/index").DocumentWorkerRequest
      const worker: {
        createDocumentWorkerClient(): {
          request(input: Request): Promise<Terminal>
          terminate(): void
        }
        createDocumentRequestEnvelope(
          documentId: string,
          generation: number,
          revision?: number,
        ): Omit<Extract<Request, { type: "healthCheck" }>, "type">
      } = await import(paths.worker)
      const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
      const roles = [700, 701, 702].map((value) => `body.${id(value)}`)
      const body = (featureId: string, outputRole = "result") => ({
        schemaVersion: 0 as const,
        featureId,
        outputRole,
      })
      const base = (
        featureId: string,
        type: typeof domain.compoundFeatureType.type,
        parameters: unknown,
        dependencies: string[],
        suppressed = false,
      ) => ({
        schemaVersion: 0 as const,
        id: featureId,
        type,
        parameters,
        dependencies,
        references: [],
        suppressed,
      })
      const box = (index: number, width = 10, suppressed = false) =>
        base(
          id(index),
          domain.boxFeatureType.type,
          {
            width: domain.createLengthQuantity(width),
            depth: domain.createLengthQuantity(20),
            height: domain.createLengthQuantity(30),
            centered: false,
            origin: {
              x: domain.createLengthQuantity(30 * (index - 1)),
              y: domain.createLengthQuantity(0),
              z: domain.createLengthQuantity(0),
            },
          },
          [],
          suppressed,
        )
      const compound = (order = [1, 2, 3]) =>
        base(
          id(4),
          domain.compoundFeatureType.type,
          {
            slots: order.map((index) => ({ slotId: id(699 + index), targetBody: body(id(index)) })),
          },
          order.map(id),
        )
      const placement = (feature: number, slot: number) =>
        base(
          id(feature),
          domain.placementFeatureType.type,
          {
            targetBody: body(id(4), `body.${id(699 + slot)}`),
            translation: {
              x: domain.createLengthQuantity(0),
              y: domain.createLengthQuantity(100),
              z: domain.createLengthQuantity(0),
            },
            rotation: {
              x: domain.createAngleQuantity(0),
              y: domain.createAngleQuantity(0),
              z: domain.createAngleQuantity(0),
            },
          },
          [id(4)],
        )
      const client = worker.createDocumentWorkerClient()
      let revision = 0
      async function rebuild(features: ReturnType<typeof base>[]) {
        revision += 1
        const parsed = features.map((feature) => domain.featureRecordSchema.parse(feature))
        const result = await client.request({
          ...worker.createDocumentRequestEnvelope(id(99), 1, revision),
          type: "rebuildDocument",
          document: protocol.documentRebuildSnapshotSchema.parse({
            schemaVersion: 0,
            id: id(99),
            revision,
            name: "Compound rebuild fixture",
            displayUnits: { length: "mm", angle: "deg" },
            variables: [],
            sketches: [],
            features,
            createdAt: "2026-10-03T00:00:00Z",
            updatedAt: "2026-10-03T00:00:00Z",
          }),
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        })
        if (result.type !== "documentRebuilt") throw new Error(`Unexpected ${result.type}.`)
        const geometry = result.geometry.map(({ featureId, contentHash, geometry }) => {
          if (!geometry.bodies)
            throw new Error("Combination evidence requires exact named body outputs.")
          return {
            featureId,
            contentHash,
            shape: geometry.shape,
            bodies: geometry.bodies.map(({ outputRole, shape }) => ({
              featureId,
              outputRole,
              shape,
            })),
          }
        })
        const terminal = domain.terminalBodyOutputs(
          parsed,
          new Map(geometry.map((entry) => [entry.featureId, entry.bodies])),
        )
        if (!terminal) throw new Error("Terminal exact body outputs could not be resolved.")
        return {
          evaluation: result.evaluation,
          geometry,
          terminal: terminal.map(({ featureId, outputRole }) => ({ featureId, outputRole })),
        }
      }
      const dependents = [placement(5, 2), placement(6, 3)]
      try {
        const initial = await rebuild([box(1), box(2), box(3), compound(), ...dependents])
        const reused = await rebuild([box(1), box(2), box(3), compound(), ...dependents])
        const reordered = await rebuild([
          box(1),
          box(2),
          box(3),
          compound([3, 2, 1]),
          ...dependents,
        ])
        const edited = await rebuild([
          box(1, 14),
          box(2),
          box(3),
          compound([3, 2, 1]),
          ...dependents,
        ])
        const suppressed = await rebuild([
          box(1, 14, true),
          box(2),
          box(3),
          compound(),
          ...dependents,
        ])
        const restored = await rebuild([box(1, 14), box(2), box(3), compound(), ...dependents])
        const removed = await rebuild([box(1, 14), box(2), box(3), compound([1, 2]), ...dependents])
        const recovered = await rebuild([box(1, 14), box(2), box(3), compound(), ...dependents])
        const disposal = await client.request({
          ...worker.createDocumentRequestEnvelope(id(99), 1, revision),
          type: "disposeDocument",
        })
        return {
          initial,
          reused,
          reordered,
          edited,
          suppressed,
          restored,
          removed,
          recovered,
          disposal,
          ids: [1, 2, 3, 4, 5, 6].map(id),
          roles,
        }
      } finally {
        client.terminate()
      }
    },
    {
      domain: source("packages/domain/src/index.ts"),
      protocol: source("packages/protocol/src/index.ts"),
      worker: source("packages/document-worker/src/client.ts"),
    },
  )
  await test.info().attach("body-combination-rebuild-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  })
  const feature = (result: typeof evidence.initial, index: number) =>
    result.geometry.find(({ featureId }) => featureId === evidence.ids[index - 1])
  function assertStableAuthoredSlots() {
    expect(feature(evidence.initial, 4)?.shape).toMatchObject({ valid: true, solidCount: 3 })
    expect(feature(evidence.initial, 4)?.shape.volume).toBeCloseTo(18000, 5)
    expect(feature(evidence.reordered, 4)?.bodies.map(({ outputRole }) => outputRole)).toEqual(
      [...evidence.roles].reverse(),
    )
    for (const body of feature(evidence.initial, 4)?.bodies ?? [])
      expect(
        feature(evidence.reordered, 4)?.bodies.find(
          ({ outputRole }) => outputRole === body.outputRole,
        )?.shape,
      ).toEqual(body.shape)
  }
  function assertDependentShapePreservation() {
    expect(feature(evidence.edited, 4)?.shape.volume).toBeCloseTo(20400, 5)
    for (const index of [5, 6]) {
      expect(feature(evidence.edited, index)?.shape).toEqual(
        feature(evidence.initial, index)?.shape,
      )
      expect(feature(evidence.edited, index)?.contentHash).not.toBe(
        feature(evidence.initial, index)?.contentHash,
      )
    }
  }
  for (const result of [
    evidence.initial,
    evidence.reordered,
    evidence.edited,
    evidence.restored,
    evidence.recovered,
  ])
    expect(result.evaluation.records.map(({ status }) => status)).toEqual(
      Array(6).fill("succeeded"),
    )
  expect(evidence.reused.evaluation.reusedFeatureIds).toEqual(evidence.ids)
  assertStableAuthoredSlots()
  assertDependentShapePreservation()
  expect(evidence.suppressed.evaluation.records.map(({ status }) => status)).toEqual([
    "suppressed",
    "succeeded",
    "succeeded",
    "blocked",
    "blocked",
    "blocked",
  ])
  expect(evidence.suppressed.terminal).toEqual(
    [2, 3].map((index) => ({ featureId: evidence.ids[index - 1], outputRole: "result" })),
  )
  expect(evidence.removed.evaluation.records.map(({ status }) => status)).toEqual([
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "failed",
  ])
  expect(evidence.removed.terminal).toEqual([
    { featureId: evidence.ids[2], outputRole: "result" },
    { featureId: evidence.ids[3], outputRole: evidence.roles[0] },
    { featureId: evidence.ids[4], outputRole: "result" },
  ])
  expect(evidence.recovered.terminal).toEqual([
    { featureId: evidence.ids[3], outputRole: evidence.roles[0] },
    { featureId: evidence.ids[4], outputRole: "result" },
    { featureId: evidence.ids[5], outputRole: "result" },
  ])
  expect(evidence.disposal).toMatchObject({ type: "documentDisposed", ownedShapeCount: 0 })
})
