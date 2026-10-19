import { resolve } from "node:path"
import { expect, test } from "./fixtures"

type DrawBounds = {
  minDepth: number
  minClip: number
  maxClip: number
  scale: number[]
  positions: number[]
  depthAxis: number[]
}
type GridDraw = { spacing: number; fade: number; right: number[]; up: number[]; vertices: number }
type CameraProjection = Readonly<Record<"a" | "b" | "c" | "d" | "e" | "f", number>>

type ClippingEvidence = {
  modelBefore: DrawBounds
  modelAfter: DrawBounds
  grid: GridDraw[]
  planes: DrawBounds[]
  bed: DrawBounds[]
  views: (CameraProjection | null)[]
  highlights: DrawBounds[]
  handles: DrawBounds[]
}

test("keeps the analytic grid, origin planes, and finite decorations complete after fitting a small model", async ({
  page,
}) => {
  await page.goto("/spikes/body-selection.html")
  const moduleUrl = `/@fs${resolve("packages/viewer/src/three-viewport.ts")}`
  const result = await page.evaluate<ClippingEvidence>(`(async () => {
    const { createGeometryViewport } = await import(${JSON.stringify(moduleUrl)})
    const canvas = document.createElement("canvas")
    canvas.style.cssText = "position:fixed;width:600px;height:400px"
    document.body.append(canvas)
    const viewport = createGeometryViewport(canvas)
    const gl = canvas.getContext("webgl2")
    const drawArrays = gl.drawArrays.bind(gl)
    const drawElements = gl.drawElements.bind(gl)
    const grid = []
    const planes = []
    const bed = []
    const views = []
    const highlights = []
    const handles = []
    let model = null
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const settled = async () => { await frame(); await frame() }
    function bounds(points) {
      const program = gl.getParameter(gl.CURRENT_PROGRAM)
      const projection = gl.getUniform(program, gl.getUniformLocation(program, "projectionMatrix"))
      const view = gl.getUniform(program, gl.getUniformLocation(program, "modelViewMatrix"))
      const depths = points.map(([x, y, z]) => -(view[2]*x + view[6]*y + view[10]*z + view[14]))
      const clips = depths.map(depth => projection[10]*-depth + projection[14])
      const positions = points.flatMap(([x,y,z]) => [
        projection[0]*(view[0]*x + view[4]*y + view[8]*z + view[12]) + projection[12],
        projection[5]*(view[1]*x + view[5]*y + view[9]*z + view[13]) + projection[13],
      ])
      return { minDepth: Math.min(...depths), minClip: Math.min(...clips), maxClip: Math.max(...clips),
        scale: [projection[0], projection[5]], positions, depthAxis: [view[2],view[6],view[10]] }
    }
    const corners = size => [[-size,-size,0], [size,-size,0], [size,size,0], [-size,size,0]]
    gl.drawArrays = function(...args) {
      if (args[0] === gl.LINES && args[2] === 8) planes.push(bounds(corners(32)))
      if (args[0] === gl.LINES && args[2] === 24) bed.push(bounds(
        [-100,100].flatMap(x => [-80,80].flatMap(y => [-125,125].map(z => [x,y,z])))
      ))
      return drawArrays(...args)
    }
    gl.drawElements = function(...args) {
      const program = gl.getParameter(gl.CURRENT_PROGRAM)
      const gridSpacing = gl.getUniformLocation(program, "gridSpacing")
      if (gridSpacing !== null) grid.push({
        spacing: gl.getUniform(program, gridSpacing),
        fade: gl.getUniform(program, gl.getUniformLocation(program, "gridFade")),
        right: Array.from(gl.getUniform(program, gl.getUniformLocation(program, "gridRight"))),
        up: Array.from(gl.getUniform(program, gl.getUniformLocation(program, "gridUp"))),
        vertices: args[1],
      })
      if (args[0] === gl.TRIANGLES && args[1] === 3)
        model = bounds([[0,0,0], [8,0,0], [0,8,0]])
      if (args[0] === gl.TRIANGLES && args[1] === 9)
        highlights.push(bounds([[0,0,100], [8,0,100], [0,8,100]]))
      if (args[0] === gl.TRIANGLES && args[1] === 72)
        handles.push(bounds([-0.6,0.6].flatMap(x => [-0.6,0.6].flatMap(y => [-0.6,0.6].map(z => [x,y,z])))))
      return drawElements(...args)
    }
    try {
      viewport.setOriginPlaneVisibility({xy:false, xz:false, yz:false})
      viewport.setMeshes([{
        featureId: "small-triangle", positions: new Float32Array([0,0,0,8,0,0,0,8,0]),
        normals: new Float32Array([0,0,1,0,0,1,0,0,1]), indices: new Uint32Array([0,1,2]),
        triangleFaceIds: new Uint32Array([1]),
      }])
      viewport.fit()
      await settled()
      const modelBefore = model
      viewport.setGroundGrid(true)
      viewport.setOriginPlaneVisibility({xy:true, xz:true, yz:true})
      await settled()
      const modelAfter = model
      // Wheel zoom must not expose a clipped band after Fit.
      for (let index = 0; index < 20; index++) canvas.dispatchEvent(new WheelEvent("wheel", {
        deltaY: 100, clientX: 300, clientY: 200, bubbles: true, cancelable: true,
      }))
      await settled()
      const isoLength = Math.hypot(1,-1,0.8)
      const diagonal = Math.SQRT2
      const frames = {
        front: {origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,0,1],normal:[0,-1,0]},
        top: {origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]},
        isometric: {origin:[0,0,0],xAxis:[1/diagonal,1/diagonal,0],
          yAxis:[-0.8/(isoLength*diagonal),0.8/(isoLength*diagonal),2/(isoLength*diagonal)],
          normal:[1/isoLength,-1/isoLength,0.8/isoLength]},
      }
      for (const view of ["front", "top", "isometric"]) {
        viewport.setStandardView(view)
        let projection = null
        viewport.setSketchPlaneProjection(frames[view], value => {projection = value})
        await settled()
        views.push(projection)
      }
      viewport.setSketchPlaneProjection(null)
      viewport.setPrintBed({width:200, depth:160, height:250, margin:0})
      viewport.fit()
      await settled()
      viewport.setPrintBed(null)
      viewport.setStandardView("top")
      await settled()
      // A consumed History feature can extend beyond the terminal body.
      const highlight = {
        featureId: "consumed-predecessor", positions: new Float32Array([0,0,100,8,0,100,0,8,100]),
        normals: new Float32Array([0,0,1,0,0,1,0,0,1]),
        indices: new Uint32Array([0,1,2,0,1,2,0,1,2]), triangleFaceIds: new Uint32Array([1,1,1]),
      }
      viewport.setFeaturePreselection(highlight)
      await settled()
      viewport.setFeaturePreselection(null)
      viewport.setFeatureSelection(highlight)
      await settled()
      viewport.setFeatureSelection(null)
      viewport.setGroundGrid(false)
      viewport.setOriginPlaneVisibility({xy:false, xz:false, yz:false})
      viewport.fit()
      viewport.showTranslationGizmo([8,0,0])
      await settled()
      return {modelBefore, modelAfter, grid, planes, bed, views, highlights, handles}
    } finally {
      gl.drawArrays = drawArrays
      gl.drawElements = drawElements
      viewport.dispose()
      canvas.remove()
    }
  })()`)
  expectAnalyticGrid(result)
  expectModelFraming(result)
  expectStandardViewAlignment(result)
  expectCompleteDepthRange(result)
})

function expectAnalyticGrid(result: ClippingEvidence) {
  expect(result.grid.length).toBeGreaterThanOrEqual(3)
  for (const grid of result.grid) {
    expect(grid.vertices).toBe(6)
    expect(grid.spacing).toBeGreaterThan(0)
    expect(grid.fade).toBeGreaterThan(0)
    expect(grid.fade).toBeLessThanOrEqual(1)
    expect([...grid.right, ...grid.up].every(Number.isFinite)).toBe(true)
  }
}

function expectModelFraming(result: ClippingEvidence) {
  expect(result.planes.length).toBeGreaterThanOrEqual(15)
  expect(result.bed.length).toBeGreaterThan(0)
  expect(result.highlights.length).toBeGreaterThanOrEqual(2)
  expect(result.handles.length).toBeGreaterThan(0)
  expect(result.modelAfter.scale).toEqual(result.modelBefore.scale)
  for (const [index, value] of result.modelBefore.positions.entries()) {
    expect(result.modelAfter.positions[index]).toBeCloseTo(value, 5)
  }
}

function expectStandardViewAlignment(result: ClippingEvidence) {
  for (const projection of result.views) {
    if (!projection) throw new Error("The standard-view support plane projection is missing.")
    expect(projection.a).toBeGreaterThan(0)
    expect(projection.d).toBeLessThan(0)
    expect(projection.b).toBeCloseTo(0, 8)
    expect(projection.c).toBeCloseTo(0, 8)
    expect(projection.a).toBeCloseTo(-projection.d / 1.5, 8)
  }
}

function expectCompleteDepthRange(result: ClippingEvidence) {
  for (const bounds of [
    ...result.planes,
    ...result.bed,
    ...result.highlights,
    ...result.handles,
    result.modelAfter,
  ]) {
    expect(bounds.minDepth).toBeGreaterThan(0)
    expect(bounds.minClip).toBeGreaterThanOrEqual(-1)
    expect(bounds.maxClip).toBeLessThanOrEqual(1)
  }
}
