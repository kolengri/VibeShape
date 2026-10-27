import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { featureGeometryRecordSchema } from "@vibeshape/application/feature-rebuild"
import { terminalBodyGeometry } from "@vibeshape/application/model-bodies"
import { resolveSelectedEdgeCandidates } from "@vibeshape/application/selected-edge-resolution"
import { type SupportFrame, sketchFrame } from "@vibeshape/application/support-frame"
import { inspectPlanarSupportHealth } from "@vibeshape/application/support-health"
import {
  booleanFeatureType,
  boxFeatureType,
  chamferFeatureTypeV2,
  createAngleQuantity,
  createLengthQuantity,
  createRectangleSketch,
  cylinderFeatureType,
  type DocumentSnapshot,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  extrusionFeatureType,
  type FeatureRecord,
  featureEvaluationRecordSchema,
  featureIdSchema,
  featureRecordSchema,
  filletFeatureTypeV2,
  type PlanarFaceTopoRef,
  placementFeatureType,
  planarFaceTopoRefSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerResponse,
  documentWorkerResponseSchema,
  type TopologyCandidate,
} from "@vibeshape/protocol"
import {
  createSketchProfileSelector,
  detectSketchProfiles,
  type NativeSketchSolverModule,
  solveSketchRecord,
} from "@vibeshape/sketch-solver"
import { vi } from "../../../tests/unit/support/bun-test"
import initializeSolver from "../../sketch-solver/runtime/vibeshape_slvs.mjs"
import { DocumentWorkerRuntime } from "./runtime"

type Rebuilt = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>
type Vector = readonly [number, number, number]
type Producer = "boolean" | "fillet" | "chamfer" | "placement"
const engine = new ReplicadGeometryEngine(resolveSelectedEdgeCandidates)
const documentId = "0195b5ac-b220-7a2c-8c33-000000050000"
let nextId = 50_001
let nativeSolver: NativeSketchSolverModule
const id = () => `0195b5ac-b220-7a2c-8c33-${String(nextId++).padStart(12, "0")}`
const length = createLengthQuantity
const vector = (x: number, y: number, z: number) => ({ x: length(x), y: length(y), z: length(z) })

beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const wasm = readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasm))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
  nativeSolver = await initializeSolver({
    locateFile: () =>
      new URL("../../sketch-solver/runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
  })
}, 60_000)
afterAll(() => {
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
})

function feature(
  type: FeatureRecord["type"],
  parameters: unknown,
  dependencies: readonly string[] = [],
  references: FeatureRecord["references"] = [],
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(),
    type,
    parameters,
    dependencies,
    references,
    suppressed: false,
  })
}
function document(features: readonly FeatureRecord[]) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 1,
    name: "Complex planar sketch supports",
    variables: [],
    sketches: [],
    features,
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
  })
}
function runtime() {
  const messages: DocumentWorkerResponse[] = []
  return {
    messages,
    worker: new DocumentWorkerRuntime(
      engine,
      { postMessage: (message) => messages.push(message) },
      undefined,
      (input) => solveSketchRecord(nativeSolver, input),
    ),
  }
}
async function rebuild(session: ReturnType<typeof runtime>, snapshot: DocumentSnapshot) {
  const requestId = id()
  await session.worker.handle({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId,
    documentId,
    revision: snapshot.revision,
    generation: snapshot.revision,
    type: "rebuildDocument",
    document: snapshot,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  })
  const result = session.messages.find(
    (message) => message.requestId === requestId && message.type === "documentRebuilt",
  )
  if (result?.type !== "documentRebuilt") throw new Error(JSON.stringify(session.messages))
  expect(documentWorkerResponseSchema.safeParse(result).success).toBe(true)
  const unsuccessful = result.evaluation.records.filter(({ status }) => status !== "succeeded")
  if (unsuccessful.length) throw new Error(JSON.stringify(unsuccessful))
  expect(result.evaluation.records.map(({ status }) => status)).toEqual(
    snapshot.features.map(() => "succeeded"),
  )
  return result
}
function geometry(result: Rebuilt, featureId: string) {
  const record = result.geometry.find((entry) => entry.featureId === featureId)
  if (!record) throw new Error(`Missing geometry for ${featureId}`)
  return record.geometry
}
function terminalBodies(snapshot: DocumentSnapshot, result: Rebuilt) {
  return terminalBodyGeometry({
    features: snapshot.features,
    geometry: result.geometry.map((record) => featureGeometryRecordSchema.parse(record)),
    evaluation: {
      records: result.evaluation.records.map((record) =>
        featureEvaluationRecordSchema.parse(record),
      ),
      dirtyFeatureIds: result.evaluation.dirtyFeatureIds.map((value) =>
        featureIdSchema.parse(value),
      ),
      evaluatedFeatureIds: result.evaluation.evaluatedFeatureIds.map((value) =>
        featureIdSchema.parse(value),
      ),
      reusedFeatureIds: result.evaluation.reusedFeatureIds.map((value) =>
        featureIdSchema.parse(value),
      ),
    },
  })
}
function unique(
  candidates: readonly TopologyCandidate[],
  match: (value: TopologyCandidate) => boolean,
) {
  const matches = candidates.filter(match)
  if (matches.length !== 1 || !matches[0])
    throw new Error(`Expected one candidate, got ${matches.length}`)
  return matches[0]
}
function reference(featureId: string, candidate: TopologyCandidate): PlanarFaceTopoRef {
  return planarFaceTopoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind: "face",
    signature: candidate.signature,
    ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
    ...(candidate.lineageTokens[0] ? { lineageToken: candidate.lineageTokens[0] } : {}),
    intent: {
      nearPoint: candidate.signature.centroid.map(
        (value, axis) => value + 2.5 * (candidate.signature.direction?.[axis] ?? 0),
      ),
    },
  })
}
function supportedProfile(support: PlanarFaceTopoRef) {
  const rectangle = createRectangleSketch({
    id: sketchIdSchema.parse(id()),
    label: "Supported rectangle",
    plane: "xy",
    width: length(2),
    height: length(1),
    createEntityId: () => sketchEntityIdSchema.parse(id()),
    createConstraintId: () => sketchConstraintIdSchema.parse(id()),
  })
  const sketch = sketchRecordSchema.parse({
    ...rectangle,
    support: { kind: "feature-face", reference: support },
    constraints: rectangle.entities.flatMap((entity) =>
      entity.type === "point"
        ? [{ schemaVersion: 0, id: id(), type: "fixed", pointId: entity.id }]
        : [],
    ),
  })
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
  )
  const selector = createSketchProfileSelector(
    sketch.id,
    detectSketchProfiles(sketch, { points, circles: [] }),
    0,
  )
  if (!selector) throw new Error("Expected a closed rectangular profile.")
  const extrusion = feature(
    extrusionFeatureType.type,
    {
      profile: selector,
      distance: length(3),
      symmetric: false,
      operation: "new",
    },
    [support.featureId],
    [support],
  )
  return { sketch, extrusion }
}
function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function subtract(a: Vector, b: Vector): Vector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function assertFrame(frame: SupportFrame, candidate: TopologyCandidate) {
  const normal = candidate.signature.direction
  if (!normal) throw new Error("An oriented planar face requires a normal.")
  for (const axis of [frame.xAxis, frame.yAxis, frame.normal])
    expect(Math.hypot(...axis)).toBeCloseTo(1, 10)
  expect(dot(frame.xAxis, frame.yAxis)).toBeCloseTo(0, 10)
  expect(dot(frame.xAxis, frame.normal)).toBeCloseTo(0, 10)
  expect(dot(frame.yAxis, frame.normal)).toBeCloseTo(0, 10)
  expect(dot(cross(frame.xAxis, frame.yAxis), frame.normal)).toBeCloseTo(1, 10)
  expect(dot(frame.normal, normal)).toBeCloseTo(1, 10)
  expect(dot(subtract(frame.origin, candidate.signature.centroid), normal)).toBeCloseTo(0, 7)
  for (const axis of [0, 1, 2])
    expect(frame.origin[axis]).toBeCloseTo(candidate.signature.centroid[axis] ?? Infinity, 7)
}
function expectedBounds(frame: SupportFrame) {
  const corners = [0, 2].flatMap((x) =>
    [0, 1].flatMap((y) =>
      [0, 3].map((z) =>
        frame.origin.map(
          (origin, axis) =>
            origin +
            x * (frame.xAxis[axis] ?? 0) +
            y * (frame.yAxis[axis] ?? 0) +
            z * (frame.normal[axis] ?? 0),
        ),
      ),
    ),
  )
  return {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis] ?? Infinity))),
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis] ?? -Infinity))),
  }
}
async function producer(kind: Producer) {
  const session = runtime()
  const box = feature(boxFeatureType.type, {
    width: length(20),
    depth: length(12),
    height: length(10),
    centered: false,
    origin: vector(0, 0, 0),
  })
  let source = document([box])
  const initial = await rebuild(session, source)
  let owner: FeatureRecord
  if (kind === "chamfer" || kind === "fillet") {
    const edge = unique(
      geometry(initial, box.id).topologyCandidates,
      ({ kind: topologyKind, signature }) =>
        topologyKind === "edge" &&
        Math.abs(signature.centroid[1] + 6) < 1e-7 &&
        Math.abs(signature.centroid[2] - 10) < 1e-7 &&
        signature.measure > 19,
    )
    const edgeReference = {
      schemaVersion: 0 as const,
      featureId: box.id,
      kind: "edge" as const,
      signature: edge.signature,
      ...(edge.semanticRole ? { semanticRole: edge.semanticRole } : {}),
    }
    owner = feature(
      kind === "chamfer" ? chamferFeatureTypeV2.type : filletFeatureTypeV2.type,
      kind === "chamfer" ? { distance: length(1) } : { radius: length(1) },
      [box.id],
      [edgeReference],
    )
    source = documentSnapshotSchema.parse({ ...source, revision: 2, features: [box, owner] })
  } else {
    const cylinder = feature(cylinderFeatureType.type, {
      radius: length(2),
      height: length(14),
      centered: false,
      origin: vector(3, 0, -2),
    })
    const cut = feature(booleanFeatureType.type, { operation: "subtract" }, [box.id, cylinder.id])
    owner = cut
    const features = [box, cylinder, cut]
    if (kind === "placement") {
      owner = feature(
        placementFeatureType.type,
        {
          targetBody: { schemaVersion: 0, featureId: cut.id, outputRole: "result" },
          translation: vector(25, -9, 14),
          rotation: {
            x: createAngleQuantity(Math.PI / 7),
            y: createAngleQuantity(Math.PI / 5),
            z: createAngleQuantity(Math.PI / 9),
          },
        },
        [cut.id],
      )
      features.push(owner)
    }
    source = documentSnapshotSchema.parse({ ...source, revision: 2, features })
  }
  const rebuilt = await rebuild(session, source)
  return { session, source, rebuilt, owner }
}

function assertProducerDirections(kind: Producer, faces: readonly TopologyCandidate[]) {
  if (kind === "boolean") {
    expect(faces.every(({ semanticRole }) => semanticRole === undefined)).toBe(true)
    for (const normal of [
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ] as const)
      expect(
        faces.some(
          ({ signature }) => signature.direction && dot(signature.direction, normal) > 1 - 1e-9,
        ),
      ).toBe(true)
  }
  if (kind === "chamfer")
    expect(
      faces.some(
        ({ signature }) =>
          signature.direction &&
          dot(signature.direction, [0, -Math.SQRT1_2, Math.SQRT1_2]) > 1 - 1e-9,
      ),
    ).toBe(true)
}

function assertProducerGeometry(kind: Producer, ownerGeometry: ReturnType<typeof geometry>) {
  expect(ownerGeometry.shape).toMatchObject({ valid: true, solidCount: 1 })
  if (kind === "boolean" || kind === "placement")
    expect(ownerGeometry.shape.volume).toBeCloseTo(2400 - 40 * Math.PI, 6)
  if (kind === "fillet")
    expect(ownerGeometry.shape.volume).toBeCloseTo(2400 - 20 * (1 - Math.PI / 4), 6)
  if (kind === "chamfer") expect(ownerGeometry.shape.volume).toBeCloseTo(2390, 6)
  const faces = ownerGeometry.topologyCandidates.filter(
    ({ kind: topologyKind, signature }) =>
      topologyKind === "face" &&
      signature.geometryClass === "PLANE" &&
      signature.directionMode === "oriented",
  )
  expect(faces.length).toBe(kind === "chamfer" ? 7 : 6)
  assertProducerDirections(kind, faces)
  return faces
}

type ProfileOnFace = ReturnType<typeof supportedProfile> & { candidate: TopologyCandidate }
function supportFrames(
  profiles: readonly ProfileOnFace[],
  saved: DocumentSnapshot,
  rebuilt: Rebuilt,
) {
  return profiles.map(({ sketch, candidate }) => {
    if (!sketch.support) throw new Error("Expected a persisted face support.")
    expect(inspectPlanarSupportHealth(sketch.support.reference, rebuilt)).toEqual({
      status: "resolved",
    })
    const frame = sketchFrame(sketch, saved, saved.features, new Set(), rebuilt.geometry)
    if (!frame) throw new Error(`Unresolved planar support ${JSON.stringify(candidate.signature)}`)
    assertFrame(frame, candidate)
    return frame
  })
}

function assertExtrudedBounds(shape: ReturnType<typeof geometry>["shape"], frame: SupportFrame) {
  const bounds = expectedBounds(frame)
  for (const axis of [0, 1, 2]) {
    expect(shape.bounds.min[axis]).toBeCloseTo(bounds.min[axis] ?? Infinity, 5)
    expect(shape.bounds.max[axis]).toBeCloseTo(bounds.max[axis] ?? Infinity, 5)
  }
}

function assertRebuiltSupports(
  result: Rebuilt,
  fixture: {
    saved: DocumentSnapshot
    owner: FeatureRecord
    ownerVolume: number
    profiles: readonly ProfileOnFace[]
    frames: readonly SupportFrame[]
  },
) {
  const { saved, owner, ownerVolume, profiles, frames } = fixture
  expect(geometry(result, owner.id).shape.volume).toBeCloseTo(ownerVolume, 7)
  const bodies = terminalBodies(saved, result)
  expect(bodies?.some(({ featureId }) => featureId === owner.id)).toBe(true)
  expect(bodies).toHaveLength(profiles.length + 1)
  for (const [index, { extrusion }] of profiles.entries()) {
    const shape = geometry(result, extrusion.id).shape
    expect(shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(shape.volume).toBeCloseTo(6, 7)
    const frame = frames[index]
    if (!frame) throw new Error("Missing expected support frame.")
    assertExtrudedBounds(shape, frame)
  }
}

describe("complex planar sketch support with the real document-worker and exact kernel", () => {
  it.each(["boolean", "fillet", "chamfer", "placement"] as const)(
    "extrudes from every unique oriented planar %s face and cold-rebuilds saved support",
    async (kind) => {
      try {
        const { session, source, rebuilt, owner } = await producer(kind)
        const ownerGeometry = geometry(rebuilt, owner.id)
        const faces = assertProducerGeometry(kind, ownerGeometry)
        const profiles = faces.map((candidate) => ({
          ...supportedProfile(reference(owner.id, candidate)),
          candidate,
        }))
        const saved = documentSnapshotSchema.parse(
          JSON.parse(
            JSON.stringify({
              ...source,
              revision: 3,
              sketches: profiles.map(({ sketch }) => sketch),
              features: [...source.features, ...profiles.map(({ extrusion }) => extrusion)],
            }),
          ),
        )
        const frames = supportFrames(profiles, saved, rebuilt)
        const first = await rebuild(session, saved)
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
        const cold = await rebuild(runtime(), saved)
        for (const result of [first, cold])
          assertRebuiltSupports(result, {
            saved,
            owner,
            ownerVolume: ownerGeometry.shape.volume,
            profiles,
            frames,
          })
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
    60_000,
  )

  it("fails closed for absent, ambiguous, curved and unoriented current native face evidence", async () => {
    try {
      const { source, rebuilt, owner } = await producer("boolean")
      const ownerGeometry = geometry(rebuilt, owner.id)
      const face = unique(
        ownerGeometry.topologyCandidates,
        ({ kind, signature }) =>
          kind === "face" &&
          signature.geometryClass === "PLANE" &&
          (signature.direction?.[2] ?? 0) > 0.99,
      )
      const support = reference(owner.id, face)
      const { sketch } = supportedProfile(support)
      const { direction: _direction, directionMode: _directionMode, ...unoriented } = face.signature
      const cylinder = unique(
        ownerGeometry.topologyCandidates,
        ({ kind, signature }) => kind === "face" && signature.geometryClass === "CYLINDRE",
      )
      const cases: ReadonlyArray<{
        status: "missing" | "ambiguous"
        candidates: TopologyCandidate[]
      }> = [
        { status: "missing", candidates: [] },
        {
          status: "ambiguous",
          candidates: [face, { ...face, candidateId: `${face.candidateId}:duplicate` }],
        },
        { status: "missing", candidates: [{ ...face, signature: unoriented }] },
        {
          status: "missing",
          candidates: [
            { ...face, signature: { ...face.signature, directionMode: "axis" as const } },
          ],
        },
        { status: "missing", candidates: [cylinder] },
      ]
      for (const { status, candidates } of cases) {
        const unavailable: Rebuilt = {
          ...rebuilt,
          geometry: rebuilt.geometry.map((record) =>
            record.featureId === owner.id
              ? { ...record, geometry: { ...record.geometry, topologyCandidates: candidates } }
              : record,
          ),
        }
        expect(inspectPlanarSupportHealth(support, unavailable)).toEqual({ status })
        expect(
          sketchFrame(sketch, source, source.features, new Set(), unavailable.geometry),
        ).toBeNull()
      }
      expect(sketchFrame(sketch, source, source.features)).toBeNull()
      expect(geometry(rebuilt, owner.id).shape.volume).toBeCloseTo(2400 - 40 * Math.PI, 6)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("prepares a signed datum on an extrusion side and extrudes from its saved native support", async () => {
    try {
      const { session, source, rebuilt, owner } = await producer("boolean")
      const top = unique(
        geometry(rebuilt, owner.id).topologyCandidates,
        ({ kind, signature }) =>
          kind === "face" &&
          signature.geometryClass === "PLANE" &&
          (signature.direction?.[2] ?? 0) > 0.99,
      )
      const first = supportedProfile(reference(owner.id, top))
      const withExtrusion = documentSnapshotSchema.parse({
        ...source,
        revision: 3,
        sketches: [first.sketch],
        features: [...source.features, first.extrusion],
      })
      const extruded = await rebuild(session, withExtrusion)
      const side = unique(
        geometry(extruded, first.extrusion.id).topologyCandidates,
        ({ kind, signature }) =>
          kind === "face" &&
          signature.geometryClass === "PLANE" &&
          (signature.direction?.[0] ?? 0) > 0.99,
      )
      expect(side.semanticRole?.startsWith("extrusion.side.")).toBe(true)
      const support = reference(first.extrusion.id, side)
      const datum = feature(
        datumPlaneFeatureType.type,
        {
          mode: "offset",
          support: { kind: "feature-face", reference: support },
          offset: length(-2),
        },
        [first.extrusion.id],
        [support],
      )
      const withDatum = documentSnapshotSchema.parse({
        ...withExtrusion,
        revision: 4,
        features: [...withExtrusion.features, datum],
      })
      const datumResult = await rebuild(session, withDatum)
      const datumFace = unique(
        geometry(datumResult, datum.id).topologyCandidates,
        ({ kind, signature }) =>
          kind === "face" &&
          signature.geometryClass === "PLANE" &&
          (signature.direction?.[0] ?? 0) > 0.99,
      )
      const second = supportedProfile(reference(datum.id, datumFace))
      const saved = documentSnapshotSchema.parse(
        JSON.parse(
          JSON.stringify({
            ...withDatum,
            revision: 5,
            sketches: [...withDatum.sketches, second.sketch],
            features: [...withDatum.features, second.extrusion],
          }),
        ),
      )
      const frame = sketchFrame(
        second.sketch,
        saved,
        saved.features,
        new Set(),
        datumResult.geometry,
      )
      if (!frame) throw new Error("Expected a datum-supported sketch frame.")
      expect(dot(frame.normal, [1, 0, 0])).toBeCloseTo(1, 10)
      expect(frame.origin[0]).toBeCloseTo(side.signature.centroid[0] - 2, 7)
      engine.disposeDocument(documentId)
      const cold = await rebuild(runtime(), saved)
      const shape = geometry(cold, second.extrusion.id).shape
      expect(shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(shape.volume).toBeCloseTo(6, 7)
      expect(shape.bounds.min[0]).toBeCloseTo(side.signature.centroid[0] - 2, 5)
      expect(shape.bounds.max[0]).toBeCloseTo(side.signature.centroid[0] + 1, 5)
      const bodies = terminalBodies(saved, cold)
      expect(bodies?.map(({ featureId }) => featureId).sort()).toEqual(
        [owner.id, first.extrusion.id, second.extrusion.id].sort(),
      )
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
})
