import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

type ResourceCounts = { uploads: number; releases: number }

test("retains equal GPU buffers and releases replaced and hidden model meshes", async ({
  page,
}) => {
  await page.goto("/spikes/body-selection.html")
  await expect(page.locator("canvas")).toBeVisible()
  const moduleUrl = `/@fs${resolve(import.meta.dirname, "../../packages/viewer/src/three-viewport.ts")}`
  const counts = await page.evaluate<{
    initial: ResourceCounts
    equal: ResourceCounts
    replacement: ResourceCounts
    hiddenReleases: number
  }>(`(async () => {
    const { createGeometryViewport } = await import(${JSON.stringify(moduleUrl)})
    const canvas = document.createElement("canvas")
    canvas.style.width = "256px"
    canvas.style.height = "256px"
    document.body.append(canvas)
    const viewport = createGeometryViewport(canvas)
    const mesh = {
      featureId: "resource-fixture",
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      triangleFaceIds: new Uint32Array([7]),
    }
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const settled = async () => { await frame(); await frame() }
    await settled()
    const prototype = WebGL2RenderingContext.prototype
    const bindBuffer = prototype.bindBuffer
    const bufferData = prototype.bufferData
    const bufferSubData = prototype.bufferSubData
    const deleteBuffer = prototype.deleteBuffer
    const arrays = new Set([mesh.positions, mesh.normals, mesh.indices])
    const modelBuffers = new Set()
    const bindings = new WeakMap()
    let uploads = 0
    let releases = 0
    prototype.bindBuffer = function (target, buffer) {
      const targets = bindings.get(this) ?? new Map()
      targets.set(target, buffer)
      bindings.set(this, targets)
      return bindBuffer.call(this, target, buffer)
    }
    prototype.bufferData = function (...args) {
      const buffer = bindings.get(this)?.get(args[0])
      if (buffer && arrays.has(args[1])) modelBuffers.add(buffer)
      if (buffer && modelBuffers.has(buffer)) uploads += 1
      return bufferData.apply(this, args)
    }
    prototype.bufferSubData = function (...args) {
      const buffer = bindings.get(this)?.get(args[0])
      if (buffer && modelBuffers.has(buffer)) uploads += 1
      return bufferSubData.apply(this, args)
    }
    prototype.deleteBuffer = function (...args) {
      if (args[0] && modelBuffers.has(args[0])) releases += 1
      return deleteBuffer.apply(this, args)
    }
    try {
      viewport.setMeshes([mesh])
      viewport.fit()
      await settled()
      const initial = { uploads, releases }
      uploads = 0
      releases = 0
      viewport.setMeshes([structuredClone(mesh)])
      await settled()
      const equal = { uploads, releases }
      uploads = 0
      releases = 0
      const changed = structuredClone(mesh)
      changed.positions[0] = 1
      arrays.add(changed.positions)
      arrays.add(changed.normals)
      arrays.add(changed.indices)
      viewport.setMeshes([changed])
      await settled()
      const replacement = { uploads, releases }
      releases = 0
      viewport.setMeshes([])
      await settled()
      return { initial, equal, replacement, hiddenReleases: releases }
    } finally {
      prototype.bindBuffer = bindBuffer
      prototype.bufferData = bufferData
      prototype.bufferSubData = bufferSubData
      prototype.deleteBuffer = deleteBuffer
      viewport.dispose()
      canvas.remove()
    }
  })()`)
  expect(counts.initial.uploads).toBeGreaterThan(0)
  expect(counts.equal).toEqual({ uploads: 0, releases: 0 })
  expect(counts.replacement.uploads).toBeGreaterThan(0)
  expect(counts.replacement.releases).toBeGreaterThan(0)
  expect(counts.hiddenReleases).toBeGreaterThan(0)
})
