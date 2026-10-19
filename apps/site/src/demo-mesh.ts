import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"

export async function loadDemoMesh(signal: AbortSignal): Promise<ViewerMesh> {
  const response = await fetch(`${import.meta.env.BASE_URL}models/demo-mounting-plate.stl`, {
    signal,
  })
  if (!response.ok) throw new Error("The demonstration mesh could not be loaded.")
  const geometry = new STLLoader().parse(await response.arrayBuffer())
  try {
    const position = geometry.getAttribute("position")
    const normal = geometry.getAttribute("normal")
    if (!position.count) {
      throw new Error("The demonstration mesh is incomplete.")
    }
    return {
      featureId: "site-demo-mounting-plate",
      appearance: "model",
      positions: new Float32Array(position.array),
      normals: new Float32Array(normal.array),
      indices: Uint32Array.from({ length: position.count }, (_, index) => index),
      // Display-only triangles have no persistent CAD face identity.
      triangleFaceIds: new Uint32Array(position.count / 3),
    }
  } finally {
    geometry.dispose()
  }
}
