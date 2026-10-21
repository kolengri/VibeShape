import {
  Mesh,
  type OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three"
import { viewerSemanticColor } from "./viewer-semantic-color"

const vertexShader = /* glsl */ `
varying vec2 gridScreen;

void main() {
  gridScreen = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec2 gridOrigin;
uniform vec2 gridRight;
uniform vec2 gridUp;
uniform vec3 gridColor;
uniform float gridSpacing;
uniform float gridBlend;
uniform float gridFade;
uniform float pixelRatio;
varying vec2 gridScreen;

float gridLine(vec2 coordinate, float width) {
  vec2 pixel = max(fwidth(coordinate), vec2(0.000001));
  vec2 distanceToLine = abs(fract(coordinate - 0.5) - 0.5) / pixel;
  float halfWidth = width * pixelRatio * 0.5;
  vec2 coverage = 1.0 - smoothstep(vec2(halfWidth - 0.5), vec2(halfWidth + 0.5), distanceToLine);
  return max(coverage.x, coverage.y);
}

void main() {
  vec2 coordinate = (gridOrigin + gridRight * gridScreen.x + gridUp * gridScreen.y) / gridSpacing;
  float minor = gridLine(coordinate, 0.55) * 0.055 * (1.0 - gridBlend);
  float major = gridLine(coordinate / 10.0, mix(0.85, 0.55, gridBlend)) * mix(0.15, 0.055, gridBlend);
  float coarse = gridLine(coordinate / 100.0, 0.85) * 0.15;
  float alpha = max(max(minor, major), coarse) * gridFade;
  if (alpha < 0.001) discard;
  gl_FragColor = vec4(gridColor, alpha);
  #include <colorspace_fragment>
}
`

function positiveRemainder(value: number, period: number) {
  return ((value % period) + period) % period
}

function validGridViewport(width: number, height: number, pixelRatio: number) {
  return Number.isFinite(width + height + pixelRatio) && width > 0 && height > 0 && pixelRatio > 0
}

/** Background XY grid: one retained quad, independent of scene bounds and semantic picking. */
export class InfiniteGridDecoration {
  readonly #cameraRight = new Vector3()
  readonly #cameraUp = new Vector3()
  readonly #cameraDirection = new Vector3()
  readonly #cameraPosition = new Vector3()
  readonly #uniforms = {
    gridOrigin: { value: new Vector2() },
    gridRight: { value: new Vector2() },
    gridUp: { value: new Vector2() },
    gridColor: { value: viewerSemanticColor("--muted-foreground") },
    gridSpacing: { value: 1 },
    gridBlend: { value: 0 },
    gridFade: { value: 1 },
    pixelRatio: { value: 1 },
  }
  readonly mesh = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      uniforms: this.#uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  #enabled = false
  #disposed = false
  #themeObserver: MutationObserver | null = null

  constructor(onThemeChange: () => void = () => {}) {
    this.mesh.name = "ground-grid"
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1_000
    this.mesh.raycast = () => {}
    if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
      this.#themeObserver = new MutationObserver(() => {
        this.#uniforms.gridColor.value.copy(viewerSemanticColor("--muted-foreground"))
        onThemeChange()
      })
      this.#themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      })
    }
  }

  setEnabled(enabled: boolean) {
    if (this.#disposed) return
    this.#enabled = enabled
    if (!enabled) this.mesh.visible = false
  }

  update(camera: OrthographicCamera, width: number, height: number, pixelRatio = 1) {
    this.mesh.visible = false
    if (this.#disposed || !this.#enabled || !validGridViewport(width, height, pixelRatio)) {
      return
    }
    camera.updateMatrixWorld()
    this.#cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
    this.#cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
    this.#cameraDirection.setFromMatrixColumn(camera.matrixWorld, 2).negate()
    this.#cameraPosition.setFromMatrixPosition(camera.matrixWorld)
    const { x: dx, y: dy, z: dz } = this.#cameraDirection
    const inclination = Math.abs(dz)
    if (inclination <= 0.025) return
    const halfWidth = (camera.right - camera.left) / (2 * camera.zoom)
    const halfHeight = (camera.top - camera.bottom) / (2 * camera.zoom)
    const rightX = (this.#cameraRight.x - (dx * this.#cameraRight.z) / dz) * halfWidth
    const rightY = (this.#cameraRight.y - (dy * this.#cameraRight.z) / dz) * halfWidth
    const upX = (this.#cameraUp.x - (dx * this.#cameraUp.z) / dz) * halfHeight
    const upY = (this.#cameraUp.y - (dy * this.#cameraUp.z) / dz) * halfHeight
    // Orthographic background coordinates extend across the camera plane, independent of scene depth.
    const centerDistance = -this.#cameraPosition.z / dz
    const centerX = this.#cameraPosition.x + dx * centerDistance
    const centerY = this.#cameraPosition.y + dy * centerDistance
    const worldUnitsPerPixel = Math.max(
      (Math.hypot(rightX, rightY) * 2) / width,
      (Math.hypot(upX, upY) * 2) / height,
    )
    const lod = Math.log10(worldUnitsPerPixel * 10)
    const spacing = 10 ** Math.floor(lod)
    const period = spacing * 100
    if (
      halfWidth <= 0 ||
      halfHeight <= 0 ||
      spacing <= 0 ||
      !Number.isFinite(
        rightX + rightY + upX + upY + centerDistance + centerX + centerY + period + lod,
      )
    ) {
      return
    }
    // Reduce the world phase in CPU doubles before the shader sees float coordinates.
    this.#uniforms.gridOrigin.value.set(
      positiveRemainder(centerX, period),
      positiveRemainder(centerY, period),
    )
    this.#uniforms.gridRight.value.set(rightX, rightY)
    this.#uniforms.gridUp.value.set(upX, upY)
    this.#uniforms.gridSpacing.value = spacing
    this.#uniforms.gridBlend.value = lod - Math.floor(lod)
    const fade = Math.min(1, (inclination - 0.025) / (0.18 - 0.025))
    this.#uniforms.gridFade.value = fade * fade * (3 - 2 * fade)
    this.#uniforms.pixelRatio.value = pixelRatio
    this.mesh.visible = true
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.mesh.visible = false
    this.#themeObserver?.disconnect()
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
