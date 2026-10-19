import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

type GridFrame = {
  sequence: number
  spacing: number
  fade: number
  origin: [number, number]
  right: [number, number]
  up: [number, number]
  bufferId: number
  indices: number
}
type GridCapture = { sequence: number; minorPixels: number; majorPixels: number; tiles: number[] }
type GridEvidence = {
  grid: GridFrame | null
  capture: GridCapture | null
  model: { view: number[]; projection: number[] } | null
}

async function evidence(page: Page): Promise<GridEvidence> {
  return page.evaluate(
    "({grid:window.__GRID_TEST__.grid,capture:window.__GRID_TEST__.capture,model:window.__GRID_TEST__.model})",
  )
}

const observeGridDraws = /* javascript */ `(() => {
  const state = window.__GRID_TEST__ = {grid:null,capture:null,model:null,sequence:0,wantCapture:false};
  const buffers = new WeakMap();
  let nextBuffer = 1;
  const draw = WebGL2RenderingContext.prototype.drawElements;
  WebGL2RenderingContext.prototype.drawElements = function(...args) {
    const result = draw.apply(this,args);
    const program = this.getParameter(this.CURRENT_PROGRAM);
    if (!program || this.getParameter(this.VIEWPORT)[2] < 200) return result;
    const spacing = this.getUniformLocation(program,"gridSpacing");
    const uniform = name => this.getUniform(program,this.getUniformLocation(program,name));
    if (spacing === null) {
      const view = this.getUniformLocation(program,"modelViewMatrix");
      const projection = this.getUniformLocation(program,"projectionMatrix");
      if (args[0] === this.TRIANGLES && args[1] > 6 && view && projection) state.model = {
        view:Array.from(this.getUniform(program,view)),projection:Array.from(this.getUniform(program,projection)),
      };
      return result;
    }
    const attribute = this.getAttribLocation(program,"position");
    const buffer = this.getVertexAttrib(attribute,this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
    if (!buffers.has(buffer)) buffers.set(buffer,nextBuffer++);
    state.grid = {sequence:++state.sequence,spacing:this.getUniform(program,spacing),fade:uniform("gridFade"),
      origin:Array.from(uniform("gridOrigin")),right:Array.from(uniform("gridRight")),up:Array.from(uniform("gridUp")),
      bufferId:buffers.get(buffer),indices:args[1]};
    if (state.wantCapture) {
      state.wantCapture = false;
      const width=this.drawingBufferWidth,height=this.drawingBufferHeight;
      const pixels=new Uint8Array(width*height*4);
      this.readPixels(0,0,width,height,this.RGBA,this.UNSIGNED_BYTE,pixels);
      const capture={sequence:state.sequence,minorPixels:0,majorPixels:0,tiles:Array(9).fill(0)};
      for (let y=10;y<height-10;y++) for(let x=10;x<width-10;x++) {
        const alpha=pixels[(y*width+x)*4+3];
        const nx=2*(x+0.5)/width-1,ny=2*(y+0.5)/height-1;
        const gx=(state.grid.origin[0]+state.grid.right[0]*nx+state.grid.up[0]*ny)/state.grid.spacing;
        const gy=(state.grid.origin[1]+state.grid.right[1]*nx+state.grid.up[1]*ny)/state.grid.spacing;
        const mx=((gx%10)+10)%10,my=((gy%10)+10)%10;
        // Samples inside a major cell cannot be antialiasing fringes of the major lines.
        if(alpha>=2 && alpha<=10 && mx>1 && mx<9 && my>1 && my<9) capture.minorPixels++;
        if(alpha>=20 && alpha<=40) capture.majorPixels++;
        if(alpha>=2 && alpha<=40) capture.tiles[Math.min(2,Math.floor(y*3/height))*3+Math.min(2,Math.floor(x*3/width))]++;
      }
      state.capture=capture;
    }
    return result;
  };
})();`

type CompleteGridEvidence = {
  grid: GridFrame
  capture: GridCapture
  model: { view: number[]; projection: number[] }
}

async function gridFrame(page: Page) {
  const { grid } = await evidence(page)
  if (!grid) throw new Error("The grid GPU draw is missing.")
  return grid
}

async function captureGrid(page: Page): Promise<CompleteGridEvidence> {
  await expect.poll(async () => (await evidence(page)).grid).not.toBeNull()
  const before = (await gridFrame(page)).sequence
  await page.evaluate("window.__GRID_TEST__.wantCapture=true")
  await page.mouse.wheel(0, 1)
  await expect
    .poll(async () => (await evidence(page)).capture?.sequence ?? 0)
    .toBeGreaterThan(before)
  const { grid, capture, model } = await evidence(page)
  if (!grid || !capture || !model) throw new Error("The grid or model GPU evidence is missing.")
  return { grid, capture, model }
}

async function createGridScene(page: Page, theme: "light" | "dark") {
  await page.addInitScript(observeGridDraws)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await page
    .locator("html")
    .evaluate((element, value) => element.classList.toggle("dark", value === "dark"), theme)
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Top", exact: true }).click()
  const canvas = page.getByRole("region", { name: "3D viewport" }).locator("canvas").first()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The grid canvas has no measurable bounds.")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  return bounds
}

function expectGridCoverage({ capture }: CompleteGridEvidence) {
  expect(capture.minorPixels).toBeGreaterThan(100)
  expect(capture.majorPixels).toBeGreaterThan(100)
  expect(capture.tiles.every((count) => count > 10)).toBe(true)
}

async function zoomGridAcrossDecade(page: Page) {
  for (let index = 0; index < 30 && (await gridFrame(page)).spacing < 10; index++) {
    const sequence = (await gridFrame(page)).sequence
    await page.mouse.wheel(0, 600)
    await expect.poll(async () => (await gridFrame(page)).sequence).toBeGreaterThan(sequence)
  }
}

function matrixComponent(matrix: number[], index: number) {
  const value = matrix[index]
  if (value === undefined) throw new Error(`The model GPU matrix is missing component ${index}.`)
  return value
}

function expectWorldAnchoring({ grid, model }: CompleteGridEvidence) {
  const screenX =
    matrixComponent(model.projection, 0) * matrixComponent(model.view, 12) +
    matrixComponent(model.projection, 12)
  const screenY =
    matrixComponent(model.projection, 5) * matrixComponent(model.view, 13) +
    matrixComponent(model.projection, 13)
  for (const axis of [0, 1] as const) {
    const coordinate =
      (grid.origin[axis] + grid.right[axis] * screenX + grid.up[axis] * screenY) / grid.spacing
    expect(Math.abs(coordinate - Math.round(coordinate))).toBeLessThan(0.001)
  }
}

async function setGroundGrid(page: Page, enabled: boolean) {
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByRole("tab", { name: "Printer build volume", exact: true }).click()
  await settings
    .getByRole("checkbox", { name: "Show XY ground grid", exact: true })
    .setChecked(enabled)
  await settings.getByRole("button", { name: "Done", exact: true }).click()
}

async function expectGridToggleRestoration(page: Page, x: number, y: number, bufferId: number) {
  await setGroundGrid(page, false)
  const hiddenSequence = (await gridFrame(page)).sequence
  await page.mouse.move(x, y)
  await page.mouse.wheel(0, -100)
  expect((await gridFrame(page)).sequence).toBe(hiddenSequence)
  await setGroundGrid(page, true)
  await expect.poll(async () => (await gridFrame(page)).sequence).toBeGreaterThan(hiddenSequence)
  expect((await gridFrame(page)).bufferId).toBe(bufferId)
}

for (const theme of ["light", "dark"] as const) {
  test(`keeps a subtle subdivided grid across pan and zoom in ${theme} theme`, async ({ page }) => {
    test.setTimeout(90_000)
    const bounds = await createGridScene(page, theme)
    const initial = await captureGrid(page)
    expect(initial.grid.indices).toBe(6)
    expectGridCoverage(initial)
    expect(initial.grid.spacing).toBeGreaterThan(0)
    await zoomGridAcrossDecade(page)
    expect((await gridFrame(page)).spacing).toBeGreaterThan(initial.grid.spacing)
    const startX = bounds.x + bounds.width * 0.4
    const startY = bounds.y + bounds.height * 0.4
    await page.mouse.move(startX, startY)
    await page.mouse.down({ button: "right" })
    await page.mouse.move(startX + bounds.width * 0.35, startY + bounds.height * 0.15, {
      steps: 10,
    })
    await page.mouse.up({ button: "right" })
    const panned = await captureGrid(page)
    expect(
      Math.hypot(matrixComponent(panned.model.view, 12), matrixComponent(panned.model.view, 13)),
    ).toBeGreaterThan(150)
    expectGridCoverage(panned)
    expect(panned.grid.bufferId).toBe(initial.grid.bufferId)
    expect(panned.grid.indices).toBe(6)
    expect(panned.grid.fade).toBe(1)
    expectWorldAnchoring(panned)
    await page.screenshot({
      path: resolve(`artifacts/project-navigation-ai-settings/grid/${theme}-pan-zoom.png`),
    })
    await expectGridToggleRestoration(page, startX, startY, initial.grid.bufferId)
    await writeFile(
      resolve(`artifacts/project-navigation-ai-settings/grid/${theme}-gpu-evidence.json`),
      JSON.stringify({ initial, panned, restored: await evidence(page) }, null, 2),
    )
  })
}
