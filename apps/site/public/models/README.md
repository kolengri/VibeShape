# Landing-page demonstration mesh

`demo-mounting-plate.stl` is an original display-only demonstration, authored for the
VibeShape landing page under the repository's GPL-3.0-or-later license. It is not a
VibeShape-authored CAD document, exact B-Rep, manufacturing export, or catalog part.

The plate is 96 × 72 × 8 mm with 8 mm corner radii, a central 32 mm through bore,
and four 6.5 mm through holes centered at (±32, ±22) mm. Its lower face is Z = 0.
The binary STL contains 2,336 triangles and is 116,884 bytes.

It was generated offline with the existing workspace's Three.js 0.185.1
`Shape`, `Path`, `ExtrudeGeometry`, and `STLExporter`. The shape contour is
counterclockwise; its five hole paths are clockwise. No CAD kernel, WASM,
document storage, or external service is involved at generation or viewing time.

Reproduce from the repository root after workspace dependencies are available:

```sh
bun --cwd apps/site --eval '
import { Shape, Path, ExtrudeGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

const shape = new Shape();
shape.moveTo(-40, -36);
shape.lineTo(40, -36);
shape.absarc(40, -28, 8, -Math.PI / 2, 0, false);
shape.lineTo(48, 28);
shape.absarc(40, 28, 8, 0, Math.PI / 2, false);
shape.lineTo(-40, 36);
shape.absarc(-40, 28, 8, Math.PI / 2, Math.PI, false);
shape.lineTo(-48, -28);
shape.absarc(-40, -28, 8, Math.PI, Math.PI * 1.5, false);
shape.closePath();

for (const [x, y, radius] of [
  [0, 0, 16], [-32, -22, 3.25], [32, -22, 3.25],
  [32, 22, 3.25], [-32, 22, 3.25],
]) {
  const hole = new Path();
  hole.absarc(x, y, radius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
}

const geometry = new ExtrudeGeometry(shape, {
  depth: 8, curveSegments: 32, steps: 1, bevelEnabled: false,
});
const data = new STLExporter().parse(new Mesh(geometry), { binary: true });
await Bun.write("public/models/demo-mounting-plate.stl", data);
geometry.dispose();
'
```

The site fetches the committed STL only when the model enters the viewport.
`STLLoader` parses its triangles; the shared VibeShape viewport owns the rendered
geometry, materials, controls, orientation inset, grid, camera, and disposal.
Triangle IDs are display-only and never used as persistent topology identity.
