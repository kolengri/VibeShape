import { Color, DoubleSide, ShaderMaterial, Vector3 } from "three"
import type { ViewerSection } from "./section-view"

const vertexShader = /* glsl */ `
uniform vec3 sectionU;
uniform vec3 sectionV;
varying vec2 sectionPoint;

void main() {
  sectionPoint = vec2(dot(position, sectionU), dot(position, sectionV));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 fillColor;
uniform vec3 gridColor;
uniform float spacing;
varying vec2 sectionPoint;

void main() {
  // A diagonal crosshatch belongs to the cut material, independent of triangle edges.
  vec2 coordinate = vec2(sectionPoint.x + sectionPoint.y, sectionPoint.x - sectionPoint.y)
    * 0.70710678 / spacing;
  vec2 pixel = max(fwidth(coordinate), vec2(0.000001));
  vec2 distanceToLine = abs(fract(coordinate - 0.5) - 0.5) / pixel;
  vec2 coverage = 1.0 - smoothstep(vec2(0.0), vec2(1.25), distanceToLine);
  // Fade compressed lines at grazing angles instead of creating moire.
  coverage *= 1.0 - smoothstep(vec2(0.25), vec2(0.5), pixel);
  float grid = max(coverage.x, coverage.y);
  gl_FragColor = vec4(mix(fillColor, gridColor, grid * 0.45), 1.0);
  #include <colorspace_fragment>
}
`

export function sectionCapMaterial(color: string, axis: ViewerSection["axis"]) {
  const normal = { x: 0, y: 1, z: 2 }[axis]
  const [u = 0, v = 1] = [0, 1, 2].filter((coordinate) => coordinate !== normal)
  const bodyColor = new Color(color)
  return new ShaderMaterial({
    uniforms: {
      sectionU: { value: new Vector3().setComponent(u, 1) },
      sectionV: { value: new Vector3().setComponent(v, 1) },
      fillColor: { value: bodyColor.clone().lerp(new Color("#ffffff"), 0.55) },
      gridColor: { value: bodyColor.clone().multiplyScalar(0.45) },
      spacing: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    side: DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}
