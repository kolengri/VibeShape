import { describe, expect, it } from "bun:test"
import { strToU8 } from "fflate"
import { parseGeometryImport } from "./index"

function svg(content: string, attributes = "") {
  return strToU8(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${content}</svg>`)
}
function dxf(entities: string, blocks = "", unit = 4) {
  return strToU8(
    `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n${blocks ? `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n` : ""}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`,
  )
}
const line = "0\nLINE\n8\nOutline\n10\n0\n20\n0\n30\n2\n11\n10\n21\n0\n31\n2\n"
const insert = "0\nINSERT\n2\nFixture\n8\nAssembly\n10\n10\n20\n20\n30\n0\n41\n2\n42\n3\n50\n90\n"
function block(entities: string) {
  return `0\nBLOCK\n2\nFixture\n70\n0\n10\n1\n20\n2\n30\n0\n${entities}0\nENDBLK\n`
}
describe("bounded analytical curve import", () => {
  it("preserves all SVG path commands as exact curves with closure", async () => {
    const result = await parseGeometryImport({
      format: "svg",
      bytes: svg(
        '<path d="M0 0 l10 0 h5 v5 q2 2 4 0 t4 0 c1 1 2 1 3 0 s2 -1 3 0 a5 3 30 0 1 5 5 Z"/>',
      ),
      units: "mm",
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "sketch-curves") throw new Error("Expected curves")
    const path = result.geometry.paths[0]
    expect(path?.closed).toBe(true)
    expect(path?.segments.map((curve) => curve.type)).toEqual([
      "line",
      "line",
      "line",
      "quadratic-bezier",
      "quadratic-bezier",
      "cubic-bezier",
      "cubic-bezier",
      "elliptical-arc",
      "line",
    ])
    const arc = path?.segments[7]
    if (arc?.type !== "elliptical-arc") throw new Error("Expected arc")
    const end = [0, 1].map(
      (axis) =>
        (arc.center[axis] ?? 0) +
        (arc.xAxis[axis] ?? 0) * Math.cos(arc.startAngle + arc.sweep) +
        (arc.yAxis[axis] ?? 0) * Math.sin(arc.startAngle + arc.sweep),
    )
    expect(end[0]).toBeCloseTo(34, 10)
    expect(end[1]).toBeCloseTo(10, 10)
  })
  it("preserves nested affine SVG transforms and physical viewBox dimensions", async () => {
    const result = await parseGeometryImport({
      format: "svg",
      bytes: svg(
        '<g transform="translate(5 0) scale(2 3)"><circle id="Cutout" cx="1" cy="2" r="1"/></g>',
        'width="20mm" height="10mm" viewBox="0 0 100 50"',
      ),
      units: "px",
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "sketch-curves") throw new Error("Expected curves")
    const path = result.geometry.paths[0]
    expect(path?.segments[0]?.type).toBe("circle")
    expect(path?.transform[0]).toBeCloseTo(1.5118110236220472)
    expect(path?.transform[5]).toBeCloseTo(2.267716535433071)
    expect(path?.transform[12]).toBeCloseTo(1)
    expect(path?.label).toBe("Cutout")
  })
  it("separates SVG continuation after closure and accepts physical shape lengths", async () => {
    const result = await parseGeometryImport({
      format: "svg",
      bytes: svg('<path d="M0 0L1 0ZL2 0"/><circle cx="1in" r="1mm"/>'),
      units: "mm",
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "sketch-curves") throw new Error("Expected curves")
    expect(result.geometry.paths.map((path) => path.closed)).toEqual([true, false, true])
    expect(result.geometry.paths[2]?.segments[0]).toMatchObject({
      type: "circle",
      center: [25.4, 0],
      radius: 1,
    })
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: svg(`<path d="M0 0${"Z".repeat(100)}"/>`),
        units: "mm",
        limits: { pathSegments: 2 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
  })
  it.each([
    ['<defs><image href="https://example.test/image"/></defs><circle r="1"/>', "unsafe-reference"],
    ['<path d="M0 0L1 1" onclick="run()"/>', "unsafe-reference"],
    ['<use href="#shape"/>', "unsupported-geometry"],
    ["<text>Hello</text>", "unsupported-geometry"],
    ['<path d="M0 0X1 1"/>', "invalid-format"],
    ['<ellipse rx="0" ry="1"/>', "invalid-geometry"],
    ['<g transform="scale(0)"><circle r="1"/></g>', "invalid-geometry"],
    ['<g transform="translate(100001 0)"><circle r="1"/></g>', "invalid-geometry"],
  ])("rejects unsafe or unsupported SVG %s", async (content, code) => {
    expect(
      await parseGeometryImport({ format: "svg", bytes: svg(content), units: "mm" }),
    ).toMatchObject({ ok: false, diagnostic: { code } })
  })
  it("rejects DTD, unresolved viewport units, depth and aggregate path budgets", async () => {
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: strToU8(
          '<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>',
        ),
        units: "mm",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsafe-reference" } })
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: svg('<circle r="1"/>', 'width="100%"'),
        units: "px",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsupported-geometry" } })
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: svg('<g><g><circle r="1"/></g></g>'),
        units: "mm",
        limits: { xmlDepth: 3 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: svg('<line x2="1"/><line x2="2"/>'),
        units: "mm",
        limits: { pathSegments: 1 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
  })
  it("reads DXF declared units, layers, planar elevation and polyline bulges exactly", async () => {
    const circle = "0\nCIRCLE\n8\nCutout\n10\n1\n20\n2\n30\n3\n40\n2\n"
    const polyline = "0\nLWPOLYLINE\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n"
    const result = await parseGeometryImport({
      format: "dxf",
      bytes: dxf(line + circle + polyline, "", 1),
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "sketch-curves") throw new Error("Expected curves")
    expect(result.geometry.units).toMatchObject({
      sourceUnit: "in",
      millimetersPerUnit: 25.4,
      policy: "declared",
    })
    expect(result.geometry.paths[0]?.transform[14]).toBe(50.8)
    expect(result.geometry.paths[1]).toMatchObject({
      layer: "Cutout",
      closed: true,
      segments: [{ type: "circle", radius: 50.8 }],
    })
    expect(result.geometry.paths[2]?.segments[0]).toMatchObject({
      type: "arc",
      center: [25.4, 0],
      radius: 25.4,
      sweep: Math.PI,
    })
  })
  it("applies DXF block base points, nonuniform scale and rotation", async () => {
    const result = await parseGeometryImport({
      format: "dxf",
      bytes: dxf(insert, block(line.replace("Outline", "0"))),
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.geometry.kind !== "sketch-curves") throw new Error("Expected curves")
    const path = result.geometry.paths[0]
    expect(path?.layer).toBe("Assembly")
    expect(path?.transform[0]).toBeCloseTo(0, 12)
    expect(path?.transform[1]).toBeCloseTo(2, 12)
    expect(path?.transform[4]).toBeCloseTo(-3, 12)
    expect(path?.transform.slice(12, 15)).toEqual([16, 18, 2])
  })
  it("requires units for unitless DXF and accepts an explicit override", async () => {
    expect(await parseGeometryImport({ format: "dxf", bytes: dxf(line, "", 0) })).toMatchObject({
      ok: false,
      diagnostic: { code: "units-required" },
    })
    expect(
      await parseGeometryImport({ format: "dxf", bytes: dxf(line, "", 0), units: "cm" }),
    ).toMatchObject({ ok: true, geometry: { units: { sourceUnit: "cm", policy: "selected" } } })
  })
  it.each([
    ["0\nSPLINE\n", "unsupported-geometry"],
    ["0\nTEXT\n1\nText\n", "unsupported-geometry"],
    [line.replace("10\n0", "10\n1garbage"), "invalid-format"],
    [`${line}210\n1\n220\n0\n230\n0\n`, "unsupported-geometry"],
    ["0\nPOLYLINE\n70\n0\n0\nVERTEX\n10\n0\n20\n0\n", "invalid-format"],
    [insert.replace("Fixture", "__proto__"), "unsafe-reference"],
    [insert.replace("41\n2", "41\n0"), "invalid-geometry"],
  ])("rejects hostile or unsupported DXF %s", async (entities, code) => {
    expect(
      await parseGeometryImport({ format: "dxf", bytes: dxf(entities, block(line)) }),
    ).toMatchObject({ ok: false, diagnostic: { code } })
  })
  it("rejects recursive blocks and bounded array expansion", async () => {
    expect(
      await parseGeometryImport({ format: "dxf", bytes: dxf(insert, block(insert)) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry" } })
    expect(
      await parseGeometryImport({ format: "dxf", bytes: dxf(`${insert}70\n129\n`, block(line)) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
  })
  it("rejects inconsistent and oversized DXF LWPOLYLINE counts before parsing", async () => {
    const polyline = "0\nLWPOLYLINE\n90\n3\n10\n0\n20\n0\n10\n1\n20\n0\n"
    expect(await parseGeometryImport({ format: "dxf", bytes: dxf(polyline) })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-format" },
    })
    expect(
      await parseGeometryImport({
        format: "dxf",
        bytes: dxf(polyline.replace("90\n3", "90\n1000000000")),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "resource-limit" } })
  })
  it("retains a complete classic DXF POLYLINE and parameterized ellipse", async () => {
    const polyline =
      "0\nPOLYLINE\n70\n0\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n1\n20\n0\n0\nSEQEND\n"
    const ellipse =
      "0\nELLIPSE\n10\n2\n20\n3\n11\n4\n21\n0\n40\n0.5\n41\n0\n42\n6.283185307179586\n"
    const result = await parseGeometryImport({ format: "dxf", bytes: dxf(polyline + ellipse) })
    expect(result).toMatchObject({
      ok: true,
      geometry: {
        paths: [
          { closed: false, segments: [{ type: "line", start: [0, 0], end: [1, 0] }] },
          {
            closed: true,
            segments: [{ type: "ellipse", center: [2, 3], xAxis: [4, 0], yAxis: [0, 2] }],
          },
        ],
      },
    })
  })
  it("rejects unknown input fields, empty geometry and enlarged budgets", async () => {
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: svg('<circle r="1"/>'),
        units: "mm",
        allowPartial: true,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
    expect(await parseGeometryImport({ format: "svg", bytes: svg(""), units: "mm" })).toMatchObject(
      { ok: false },
    )
    expect(
      await parseGeometryImport({
        format: "svg",
        bytes: svg('<circle r="1"/>'),
        units: "mm",
        limits: { xmlDepth: 65 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
  })
  it("bounds hostile source diagnostics without rejecting its result promise", async () => {
    const result = await parseGeometryImport({
      format: "svg",
      bytes: svg(`<${"a".repeat(5000)}/>`),
      units: "mm",
    })
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "unsupported-geometry" } })
    if (result.ok) throw new Error("Expected rejection")
    expect(result.diagnostic.source).toHaveLength(4096)
  })
})
