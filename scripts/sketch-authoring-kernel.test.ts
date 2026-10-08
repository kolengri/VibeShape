import { expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { cast, measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { materializeSelectedProfile } from "../packages/document-worker/src/analytical-profile-content"
import { sketchEntityIdSchema, sketchIdSchema } from "../packages/domain/src/identifiers"
import { THREAD_MAX_AUTHORED_TURNS } from "../packages/domain/src/part-design-thread"
import { authorPreparedPlanarImport } from "../packages/domain/src/planar-import-authoring"
import { type SketchRecord, sketchRecordSchema } from "../packages/domain/src/sketch"
import {
  BUNDLED_SKETCH_TEXT_FONT,
  sketchTextParametersSchema,
} from "../packages/domain/src/sketch-text"
import { applySketchTextOutline } from "../packages/domain/src/sketch-text-edit"
import { parseGeometryImport } from "../packages/formats/src/import/index"
import { preparePlanarImport } from "../packages/formats/src/planar-import-transform"
import { prepareSketchTextOutline } from "../packages/formats/src/text-outline/index"
import { exportOcctStep } from "../packages/geometry-worker/src/occt-exchange"
import { createAnalyticalFace } from "../packages/geometry-worker/src/occt-loft"
import { exportMeshedOcctStl } from "../packages/geometry-worker/src/occt-mesh"
import { extrusionProfileLoopSchema } from "../packages/protocol/src/geometry-worker"
import { sketchWireRecordSchema } from "../packages/protocol/src/sketch"
import { THREAD_CONTENT_MAX_AUTHORED_TURNS } from "../packages/protocol/src/thread-content"
import initializeSolver from "../packages/sketch-solver/runtime/vibeshape_slvs.mjs"
import { solveSketchRecord } from "../packages/sketch-solver/src/production"

const uuid = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}

async function assertNativeSketch(
  occt: OpenCascadeInstance,
  solver: Awaited<ReturnType<typeof initializeSolver>>,
  sketch: SketchRecord,
  hasHole: boolean,
) {
  const solved = solveSketchRecord(solver, { sketch, revision: 1, variables: [] })
  if (!solved.ok) throw new Error(solved.diagnostic.message)
  const result = solved.solution.profileResult
  expect(result.diagnostics).toEqual([])
  expect(result.profiles).toHaveLength(1)
  const profile = result.profiles[0]
  if (!profile) throw new Error("A closed authored profile is missing.")
  expect(profile.holeLoopIndices).toHaveLength(hasHole ? 1 : 0)
  const boundary = (index: number) => {
    const loop = result.loops[index]
    if (!loop) throw new Error("A solved profile boundary is missing.")
    return [...loop.sourceEntityIds].sort()
  }
  const selected = materializeSelectedProfile(sketch, solved.solution, {
    schemaVersion: 0,
    sketchId: sketch.id,
    outerBoundaryEntityIds: boundary(profile.outerLoopIndex),
    holeBoundaryEntityIds: profile.holeLoopIndices
      .map(boundary)
      .sort((a, b) => a.join(":").localeCompare(b.join(":"))),
  })
  if (!selected.ok) throw new Error(selected.diagnostic.code)
  const face = createAnalyticalFace(occt, {
    frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    outer: extrusionProfileLoopSchema.parse(selected.outer),
    holes: selected.holes.map((hole) => extrusionProfileLoopSchema.parse(hole)),
  })
  try {
    const vector = new occt.gp_Vec_4(0, 0, 3)
    const builder = new occt.BRepPrimAPI_MakePrism_1(face.wrapped, vector, false, true)
    const solid = (() => {
      try {
        return cast(builder.Shape()).asShape3D()
      } finally {
        builder.delete()
        vector.delete()
      }
    })()
    try {
      expect(measureVolume(solid)).toBeCloseTo(profile.area * 3, 5)
      if (!hasHole) expect(measureVolume(solid)).toBeCloseTo(288, 8)
      expect(new TextDecoder().decode(exportOcctStep(occt, solid.wrapped))).toContain(
        "ISO-10303-21",
      )
      expect(
        (await exportMeshedOcctStl(occt, solid, true).arrayBuffer()).byteLength,
      ).toBeGreaterThan(84)
    } finally {
      solid.delete()
    }
  } finally {
    face.delete()
  }
}

it("solves fixed-font holes and imported planar curves into exact exportable solids", async () => {
  expect(THREAD_CONTENT_MAX_AUTHORED_TURNS).toBe(THREAD_MAX_AUTHORED_TURNS)
  const solver = await initializeSolver({
    locateFile: () =>
      new URL("../packages/sketch-solver/runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
  })
  const occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      locateFile: () =>
        new URL(
          "../packages/geometry-worker/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
          import.meta.url,
        ).pathname,
    },
  ])
  setOC(occt)
  const parameters = sketchTextParametersSchema.parse({
    schemaVersion: 0,
    text: "O",
    font: BUNDLED_SKETCH_TEXT_FONT,
    heightMm: 10,
    alignment: { horizontal: "left", vertical: "baseline" },
    trackingMm: 0,
    kerning: true,
    layoutEngine: "unicode-scalar-kerning-v1",
    outlineSdk: "opentype.js@2.0.0",
  })
  const preparedText = await prepareSketchTextOutline(
    parameters,
    new Uint8Array(
      await readFile(
        new URL("../packages/formats/src/text-outline/fonts/NotoSans-Regular.ttf", import.meta.url),
      ),
    ),
  )
  if (!preparedText.ok) throw new Error(JSON.stringify(preparedText.diagnostics))
  let next = 10
  const text = await applySketchTextOutline(
    sketchRecordSchema.parse({
      schemaVersion: 0,
      id: uuid(1),
      label: "Outlined O",
      plane: "xy",
      entities: [],
      constraints: [],
    }),
    {
      groupId: sketchEntityIdSchema.parse(uuid(2)),
      parameters,
      origin: [0, 0],
      contours: preparedText.outline.contours,
      createEntityId: () => sketchEntityIdSchema.parse(uuid(next++)),
      hash,
    },
  )
  expect(sketchWireRecordSchema.parse(text)).toEqual(text)
  expect(
    sketchWireRecordSchema.safeParse({
      ...text,
      textGroups: text.textGroups?.map((group) => ({
        ...group,
        parameters: {
          ...group.parameters,
          font: { ...group.parameters.font, digest: "a".repeat(64) },
        },
      })),
    }).success,
  ).toBe(false)
  const imported = await parseGeometryImport({
    format: "svg",
    units: "mm",
    bytes: new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="12mm" height="8mm" viewBox="0 0 12 8"><path d="M 0 0 L 12 0 L 12 8 L 0 8 Z"/></svg>',
    ),
  })
  if (!imported.ok) throw new Error(imported.diagnostic.message)
  const planar = preparePlanarImport(imported.geometry)
  if (!planar.ok) throw new Error(planar.diagnostic.message)
  const authored = authorPreparedPlanarImport(planar.prepared, {
    id: sketchIdSchema.parse(uuid(1000)),
    label: "Imported rectangle",
    plane: "xy",
    createEntityId: () => sketchEntityIdSchema.parse(uuid(next++)),
  })
  for (const [sketch, hasHole] of [
    [text, true],
    [authored.sketch, false],
  ] as const) {
    await assertNativeSketch(occt, solver, sketch, hasHole)
  }
}, 60_000)
