// @vitest-environment node
import {
  Edge,
  Face,
  makePolygon,
  measureArea,
  measureVolume,
  type SimplePoint,
  setOC,
} from "replicad"
import initializeOC, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeAll, expect, it, vi } from "vitest"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { type AnalyticalProfile, createAnalyticalFace, validateOcctProfileSolid } from "./occt-loft"
import { createOcctLoftPatchNetwork, type LoftPatchNetwork } from "./occt-loft-filling"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const url = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOC, undefined, [{ locateFile: () => url.pathname }])
  setOC(occt)
}, 60000)
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`
function section(z: number): AnalyticalProfile {
  const points: [number, number][] = [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ]
  const segments = points.map((start, i) => ({
    entityId: id(z * 10 + i + 1) as never,
    type: "line" as const,
    startPointId: id(z * 10 + i + 10) as never,
    endPointId: id(z * 10 + ((i + 1) % 4) + 10) as never,
    start,
    end: points[(i + 1) % 4] as [number, number],
  }))
  return {
    frame: { origin: [0, 0, z], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments },
    holes: [],
  }
}
function fixture(amplitude = 0): LoftPatchNetwork {
  const sections = [section(0), section(10)]
  return {
    sections,
    outerCorrespondence: [0, 1, 2, 3].map((index) => ({
      sectionEntityIds: sections.map((s) => s.outer.segments[index]?.entityId ?? ""),
      sectionStartPointIds: sections.map((s) => {
        const segment = s.outer.segments[index]
        return segment && "startPointId" in segment ? segment.startPointId : ""
      }),
    })),
    rails: [],
    guides: amplitude
      ? [
          {
            name: "Lower-wall guide",
            segmentTrack: 0,
            path: {
              frame: {
                origin: [0, -2 - amplitude, 0],
                xAxis: [1, 0, 0],
                yAxis: [0, 0, 1],
                normal: [0, -1, 0],
              },
              sourceEntityIds: [id(300)],
              segments: [
                {
                  entityId: id(300) as never,
                  type: "line",
                  startPointId: id(301) as never,
                  endPointId: id(302) as never,
                  start: [-1, 5],
                  end: [1, 5],
                },
              ],
            },
          },
        ]
      : [],
    start: [],
    end: [],
  }
}
function projectedPoint(face: Face, point: SimplePoint) {
  const surface = occt.BRep_Tool.Surface_2(face.wrapped),
    sample = new occt.gp_Pnt_3(...point),
    projection = new occt.GeomAPI_ProjectPointOnSurf_3(
      sample,
      surface,
      1e-12,
      occt.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as never,
    ),
    adaptor = new occt.BRepAdaptor_Surface_2(face.wrapped, true),
    projected = new occt.gp_Pnt_1()
  try {
    if (!projection.IsDone() || !projection.NbPoints())
      throw new Error("Native projection did not complete.")
    const u = { current: 0 },
      v = { current: 0 }
    Reflect.apply(projection.LowerDistanceParameters, projection, [u, v])
    const uv: [number, number] = [u.current, v.current]
    adaptor.D0(...uv, projected)
    return {
      uv,
      distance: Math.hypot(
        projected.X() - point[0],
        projected.Y() - point[1],
        projected.Z() - point[2],
      ),
    }
  } finally {
    adaptor.delete()
    projected.delete()
    projection.delete()
    sample.delete()
    surface.delete()
  }
}
function maximumPrincipalCurvature(face: Face, uv: [number, number]) {
  const adaptor = new occt.BRepAdaptor_Surface_2(face.wrapped, true),
    point = new occt.gp_Pnt_1(),
    vectors = Array.from({ length: 5 }, () => new occt.gp_Vec_1())
  const [du, dv, duu, dvv, duv] = vectors
  if (!du || !dv || !duu || !dvv || !duv)
    throw new Error("A complete native surface jet is required.")
  try {
    adaptor.D2(...uv, point, du, dv, duu, dvv, duv)
    const normal = du.Crossed(dv)
    try {
      normal.Normalize()
      const E = du.Dot(du),
        F = du.Dot(dv),
        G = dv.Dot(dv),
        e = normal.Dot(duu),
        f = normal.Dot(duv),
        g = normal.Dot(dvv),
        determinant = E * G - F * F,
        mean = (e * G - 2 * f * F + g * E) / (2 * determinant),
        gaussian = (e * g - f * f) / determinant,
        spread = Math.sqrt(Math.max(0, mean * mean - gaussian))
      return Math.max(Math.abs(mean + spread), Math.abs(mean - spread))
    } finally {
      normal.delete()
    }
  } finally {
    adaptor.delete()
    point.delete()
    for (const vector of vectors) vector.delete()
  }
}
it("sews exact constrained patches into one valid positive-volume solid", () => {
  const shape = createOcctLoftPatchNetwork(occt, fixture())
  try {
    validateOcctProfileSolid(occt, shape)
    expect(measureVolume(shape)).toBeCloseTo(160, 5)
  } finally {
    shape.delete()
  }
}, 60000)
it.each(["C0", "G1", "G2"] as const)(
  "applies a real guide and %s start support with strict residual gates",
  (order) => {
    const network = fixture(0.0001),
      support = makePolygon([
        [-3, -2, -1],
        [3, -2, -1],
        [3, -2, 11],
        [-3, -2, 11],
      ])
    const baseline = createOcctLoftPatchNetwork(occt, fixture()),
      before = measureVolume(baseline)
    let shape: ReturnType<typeof createOcctLoftPatchNetwork> | undefined
    try {
      shape = createOcctLoftPatchNetwork(occt, {
        ...network,
        start: order === "C0" ? [] : [{ segmentTrack: 0, continuity: order, support }],
      })
      validateOcctProfileSolid(occt, shape)
      expect(measureVolume(shape)).toBeGreaterThan(before + 1e-5)
      const faces = shape.faces,
        guideY = -2 - 0.0001
      try {
        const wall = faces.reduce((nearest, face) =>
          projectedPoint(face, [0, guideY, 5]).distance <
          projectedPoint(nearest, [0, guideY, 5]).distance
            ? face
            : nearest,
        )
        for (const x of [-1, -0.5, 0, 0.5, 1])
          expect(projectedPoint(wall, [x, guideY, 5]).distance).toBeLessThan(1e-7)
        if (order !== "C0")
          for (const x of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
            const point: SimplePoint = [x, -2, 0],
              projection = projectedPoint(wall, point),
              normal = wall.normalAt(point)
            try {
              expect(projection.distance).toBeLessThan(1e-7)
              const [nx, ny, nz] = normal.toTuple()
              expect(
                Math.asin(Math.min(1, Math.hypot(nx, nz) / Math.hypot(nx, ny, nz))),
              ).toBeLessThan(1e-5)
              if (order === "G2")
                expect(maximumPrincipalCurvature(wall, projection.uv)).toBeLessThan(1e-4)
            } finally {
              normal.delete()
            }
          }
      } finally {
        for (const face of faces) face.delete()
      }
    } finally {
      shape?.delete()
      baseline.delete()
      support.delete()
    }
  },
  60000,
)

it("rejects nonconverging cylindrical G2 ends with a measured curvature diagnostic and preserves recovery", () => {
  const sections = [0, 10].map(
    (z): AnalyticalProfile => ({
      frame: { origin: [0, 0, z], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      outer: {
        sourceEntityIds: [1, 2, 3].map((n) => id(z * 10 + n)),
        segments: [
          {
            entityId: id(z * 10 + 1) as never,
            type: "arc",
            startPointId: id(z * 10 + 10) as never,
            endPointId: id(z * 10 + 11) as never,
            start: [2, 0],
            middle: [Math.SQRT2, Math.SQRT2],
            end: [0, 2],
          },
          {
            entityId: id(z * 10 + 2) as never,
            type: "line",
            startPointId: id(z * 10 + 11) as never,
            endPointId: id(z * 10 + 12) as never,
            start: [0, 2],
            end: [0, 0],
          },
          {
            entityId: id(z * 10 + 3) as never,
            type: "line",
            startPointId: id(z * 10 + 12) as never,
            endPointId: id(z * 10 + 10) as never,
            start: [0, 0],
            end: [2, 0],
          },
        ],
      },
      holes: [],
    }),
  )
  const sourceProfile = sections[0]
  if (!sourceProfile) throw new Error("The cylindrical source section must exist.")
  const profileFace = createAnalyticalFace(occt, sourceProfile),
    vector = new occt.gp_Vec_4(0, 0, 10),
    builder = new occt.BRepPrimAPI_MakePrism_1(profileFace.wrapped, vector, false, true)
  let cylinder: ReturnType<typeof castOcctShape>
  try {
    cylinder = adoptOcctShape(builder.Shape(), castOcctShape)
  } finally {
    builder.delete()
    vector.delete()
    profileFace.delete()
  }
  const supports = cylinder.faces
  try {
    const support = supports.find((face) => face.geomType === "CYLINDRE")
    if (!support) throw new Error("The exact cylindrical support must exist.")
    const constraint = { segmentTrack: 0, continuity: "G2" as const, support }
    const network: LoftPatchNetwork = {
      sections,
      outerCorrespondence: [0, 1, 2].map((i) => ({
        sectionEntityIds: sections.map((s) => s.outer.segments[i]?.entityId ?? ""),
        sectionStartPointIds: sections.map((s) => {
          const segment = s.outer.segments[i]
          return segment && "startPointId" in segment ? segment.startPointId : ""
        }),
      })),
      rails: [],
      guides: [],
      start: [constraint],
      end: [constraint],
    }
    let failure: unknown
    try {
      const unexpected = createOcctLoftPatchNetwork(occt, network)
      unexpected.delete()
    } catch (error) {
      failure = error
    }
    if (!(failure instanceof Error)) throw new Error("Nonconverging curved G2 must fail closed.")
    expect(failure.message).toMatch(/^OCCT Loft filling exceeded continuity tolerances/)
    expect(Number(/curvature=([\deE+.-]+)/.exec(failure.message)?.[1])).toBeGreaterThan(1e-4)
    expect(measureVolume(cylinder)).toBeCloseTo(10 * Math.PI, 5)
    const recovered = createOcctLoftPatchNetwork(occt, fixture())
    try {
      validateOcctProfileSolid(occt, recovered)
    } finally {
      recovered.delete()
    }
  } finally {
    for (const face of supports) face.delete()
    cylinder.delete()
  }
}, 120000)

it.each(["C0", "G1"] as const)(
  "rejects %s guides whose requested geometric residuals do not converge",
  (order) => {
    const support = makePolygon([
      [-3, -2, -1],
      [3, -2, -1],
      [3, -2, 11],
      [-3, -2, 11],
    ])
    try {
      expect(() =>
        createOcctLoftPatchNetwork(occt, {
          ...fixture(1),
          start: order === "C0" ? [] : [{ segmentTrack: 0, continuity: order, support }],
        }),
      ).toThrow(/exceeded.*tolerance/)
      const recovered = createOcctLoftPatchNetwork(occt, fixture())
      recovered.delete()
    } finally {
      support.delete()
    }
  },
  120000,
)

it("releases owned curves and support copies after native filling failure without deleting borrowed supports", () => {
  const support = makePolygon([
      [-3, -2, -1],
      [3, -2, -1],
      [3, -2, 11],
      [-3, -2, 11],
    ]),
    area = measureArea(support),
    edgeDelete = vi.spyOn(Edge.prototype, "delete"),
    faceDelete = vi.spyOn(Face.prototype, "delete"),
    build = vi.spyOn(occt.BRepOffsetAPI_MakeFilling.prototype, "Build").mockImplementation(() => {
      throw new Error("Injected filling failure")
    })
  try {
    expect(() =>
      createOcctLoftPatchNetwork(occt, {
        ...fixture(0.0001),
        start: [{ segmentTrack: 0, continuity: "G1", support }],
      }),
    ).toThrow("Injected filling failure")
    expect(edgeDelete.mock.contexts.length).toBeGreaterThan(4)
    expect(faceDelete.mock.contexts).not.toContain(support)
    for (const edge of edgeDelete.mock.contexts) {
      if (!(edge instanceof Edge)) throw new Error("Expected an owned Edge deletion context")
      expect(() => edge.wrapped).toThrow()
    }
    for (const face of faceDelete.mock.contexts) {
      if (!(face instanceof Face)) throw new Error("Expected an owned Face deletion context")
      expect(() => face.wrapped).toThrow()
    }
    expect(measureArea(support)).toBe(area)
  } finally {
    build.mockRestore()
    edgeDelete.mockRestore()
    faceDelete.mockRestore()
    support.delete()
  }
}, 60000)
