import {
  AmbientLight,
  BufferAttribute,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  FloatType,
  Mesh,
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three"
import { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
import type { PictureRenderSettings, PictureRenderSnapshot } from "./picture-render-input"
import { viewerBodyColor } from "./viewer-appearance"

function woodTexture() {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const grain = 0.75 + 0.25 * Math.sin(x * 0.55 + Math.sin(y * 0.08) * 2)
      const offset = (y * size + x) * 4
      pixels.set([185 * grain, 127 * grain, 69 * grain, 255], offset)
    }
  const texture = new DataTexture(pixels, size, size)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(4, 4)
  texture.needsUpdate = true
  return texture
}

function setEnvironmentColor(color: Color, outdoor: boolean, x: number, y: number, height: number) {
  const sky = y < height / 2
  color.set(outdoor ? (sky ? "#bedcf4" : "#7e8f65") : "#c6cbd4")
  const softbox = !outdoor && isSoftboxPixel(x, y)
  color.multiplyScalar(softbox ? 4 : sky ? 1 : 0.5)
}
function isSoftboxPixel(x: number, y: number) {
  return ((x > 10 && x < 32) || (x > 85 && x < 100)) && y > 10 && y < 30
}

function environment(outdoor: boolean) {
  const width = 128
  const height = 64
  const data = new Float32Array(width * height * 4)
  const color = new Color()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      setEnvironmentColor(color, outdoor, x, y, height)
      data.set([color.r, color.g, color.b, 1], (y * width + x) * 4)
    }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType)
  texture.mapping = EquirectangularReflectionMapping
  texture.needsUpdate = true
  return texture
}

type SceneResources = {
  geometries: ReturnType<typeof createViewerGeometry>[]
  materials: MeshPhysicalMaterial[]
  textures: Texture[]
}
const finishParameters = {
  matte: { opacity: 1, roughness: 0.9, metalness: 0 },
  glossy: { opacity: 1, roughness: 0.16, metalness: 0, clearcoat: 1 },
  translucent: {
    opacity: 1,
    roughness: 0.16,
    metalness: 0,
    transmission: 0.8,
    thickness: 0.15,
    ior: 1.45,
  },
  resin: {
    opacity: 1,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    transmission: 0.25,
    thickness: 0.15,
    ior: 1.45,
  },
  metal: { opacity: 1, roughness: 0.16, metalness: 0.95 },
  wood: { opacity: 1, roughness: 0.7, metalness: 0 },
} satisfies Record<PictureRenderSettings["finishes"][string], MeshPhysicalMaterialParameters>
function addWoodCoordinates(geometry: ReturnType<typeof createViewerGeometry>) {
  const positions = geometry.getAttribute("position")
  const uv = new Float32Array(positions.count * 2)
  for (let index = 0; index < positions.count; index++) {
    uv[index * 2] = positions.getX(index)
    uv[index * 2 + 1] = positions.getZ(index) + positions.getY(index) * 0.25
  }
  // The texture is private, as are the generated planar coordinates.
  geometry.setAttribute("uv", new BufferAttribute(uv, 2))
}
function baseBodyMaterial(mesh: PictureRenderSnapshot["meshes"][number]) {
  const appearance = mesh.material ?? { roughness: 0.65, metalness: 0, opacity: 1 }
  const material = new MeshPhysicalMaterial({
    color: mesh.color ?? mesh.material?.color ?? viewerBodyColor(mesh.featureId),
    roughness: appearance.roughness,
    metalness: appearance.metalness,
    opacity: appearance.opacity,
    side: DoubleSide,
  })
  return material
}
function bodyMaterial(
  mesh: PictureRenderSnapshot["meshes"][number],
  finish: PictureRenderSettings["finishes"][string] | undefined,
  geometry: ReturnType<typeof createViewerGeometry>,
  resources: SceneResources,
) {
  const material = baseBodyMaterial(mesh)
  resources.materials.push(material)
  if (finish) {
    Object.assign(material, finishParameters[finish])
    if (finish === "wood") {
      const texture = woodTexture()
      resources.textures.push(texture)
      material.map = texture
      addWoodCoordinates(geometry)
    }
  }
  return material
}
function addBody(
  scene: Scene,
  mesh: PictureRenderSnapshot["meshes"][number],
  settings: PictureRenderSettings,
  center: Vector3,
  scale: number,
  resources: SceneResources,
) {
  const { geometries } = resources
  const geometry = createViewerGeometry(mesh)
  geometries.push(geometry)
  geometry.translate(-center.x, -center.y, -center.z)
  geometry.scale(scale, scale, scale)
  if (
    mesh.normals.some(
      (value, index) =>
        index % 3 === 0 &&
        value === 0 &&
        mesh.normals[index + 1] === 0 &&
        mesh.normals[index + 2] === 0,
    )
  )
    geometry.computeVertexNormals()
  const material = bodyMaterial(mesh, settings.finishes[viewerBodyKey(mesh)], geometry, resources)
  material.transparent = material.opacity < 1
  const surface = new Mesh(geometry, material)
  surface.castShadow = true
  surface.receiveShadow = true
  scene.add(surface)
}

/** Every geometry, material and texture in this scene is owned by this render alone. */
export function createPictureScene(
  snapshot: PictureRenderSnapshot,
  settings: PictureRenderSettings,
) {
  const scene = new Scene()
  const geometries: ReturnType<typeof createViewerGeometry>[] = []
  const materials: MeshPhysicalMaterial[] = []
  const textures: Texture[] = []
  const dispose = () => {
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    for (const texture of textures) texture.dispose()
    scene.clear()
  }
  try {
    const env = environment(settings.scene === "outdoor")
    textures.push(env)
    scene.environment = env
    scene.background = new Color(
      settings.scene === "outdoor"
        ? "#b8d5ed"
        : settings.scene === "workbench"
          ? "#3a414b"
          : "#e7e9ed",
    )
    const center = snapshot.bounds.getCenter(new Vector3())
    const scale = 1 / snapshot.bounds.getSize(new Vector3()).length()
    for (const mesh of snapshot.meshes)
      addBody(scene, mesh, settings, center, scale, { geometries, materials, textures })
    const floorGeometry = new PlaneGeometry(12, 12)
    geometries.push(floorGeometry)
    const floorMaterial = new MeshPhysicalMaterial({
      color:
        settings.scene === "workbench"
          ? "#555f65"
          : settings.scene === "outdoor"
            ? "#788566"
            : "#dedee2",
      roughness: 0.85,
      side: DoubleSide,
    })
    materials.push(floorMaterial)
    if (settings.scene === "wooden-table") {
      const texture = woodTexture()
      textures.push(texture)
      floorMaterial.map = texture
      floorMaterial.color.set("#ffffff")
    }
    const floor = new Mesh(floorGeometry, floorMaterial)
    floor.position.z = (snapshot.bounds.min.z - center.z) * scale - 0.005
    floor.receiveShadow = true
    scene.add(floor)
    scene.add(new AmbientLight(0xffffff, 0.5))
    const light = new DirectionalLight(settings.scene === "outdoor" ? 0xfff0d6 : 0xffffff, 3)
    light.position.set(-2, -3, 5)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = light.shadow.camera.bottom = -2
    light.shadow.camera.right = light.shadow.camera.top = 2
    light.shadow.normalBias = 0.01
    scene.add(light)
    return {
      scene,
      dispose: () => {
        light.shadow.dispose()
        dispose()
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
