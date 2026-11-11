import { describe, expect, it } from "bun:test"
import type { AssemblySource } from "./assembly"
import {
  type AssemblyBomAuthority,
  type AssemblyBomCsvLabels,
  assemblySourceAppearances,
  CSV_UTF8_BOM,
  createAssemblyBom,
  csvField,
  formatAssemblyBomCsv,
  solidMassGrams,
  spreadsheetText,
} from "./assembly-bom"
import type { PartAppearance } from "./part-appearance"

const hash = "a".repeat(64)
function partSource(partId: string): AssemblySource {
  return {
    kind: "part",
    partId,
    body: { schemaVersion: 0, featureId: partId, outputRole: "body" },
    contentHash: hash,
  } as unknown as AssemblySource
}
const bracket = "0190a000-0000-7000-8000-000000000001"
const pin = "0190a000-0000-7000-8000-000000000002"
const unused = "0190a000-0000-7000-8000-000000000003"
const assembly: AssemblyBomAuthority = {
  definitions: [
    { id: bracket, name: 'Bracket, "left"\nrev B', sources: [partSource("p1"), partSource("p2")] },
    { id: pin, name: "Pin", sources: [partSource("p3")] },
    { id: unused, name: "Unused", sources: [partSource("p4")] },
  ],
  instances: [
    { definitionId: pin },
    { definitionId: bracket },
    { definitionId: pin },
    { definitionId: pin },
  ],
}
const pinDefinition = { id: pin, name: "Pin", sources: [partSource("p3")] }
const pinInstance = { definitionId: pin }
const occurrences = [
  { instanceId: "i2", definitionId: bracket, sourceIndex: 0, volumeMm3: 1000 },
  { instanceId: "i2", definitionId: bracket, sourceIndex: 1, volumeMm3: 500 },
  { instanceId: "i1", definitionId: pin, sourceIndex: 0, volumeMm3: 100 },
  { instanceId: "i3", definitionId: pin, sourceIndex: 0, volumeMm3: 100 },
  { instanceId: "i4", definitionId: pin, sourceIndex: 0, volumeMm3: 100 },
]
const appearances = [
  { partId: "p1", appearance: { presetId: "brass", color: "#112233" } },
  { partId: "p2", appearance: { presetId: "abs-white" } },
  { partId: "p3", appearance: { presetId: null, color: "#445566" } },
] as unknown as PartAppearance[]

const labels: AssemblyBomCsvLabels = {
  headers: {
    item: "Item",
    name: "Part",
    quantity: "Qty",
    appearance: "Appearance",
    material: "Material",
    density: "Density (kg/m3)",
    unitVolume: "Unit volume (mm3)",
    unitMass: "Unit mass (g)",
    totalMass: "Total mass (g)",
  },
  appearance: (ids) => ids.join("; "),
  material: (id) => id ?? "",
}

describe("assembly bill of materials", () => {
  it("counts every occurrence of each used definition and skips unused definitions", () => {
    const rows = createAssemblyBom({ assembly, occurrences })
    expect(rows.map(({ item, name, quantity }) => ({ item, name, quantity }))).toEqual([
      { item: 1, name: 'Bracket, "left"\nrev B', quantity: 1 },
      { item: 2, name: "Pin", quantity: 3 },
    ])
  })

  it("leaves mass unknown without an explicit density, even with exact volume", () => {
    const rows = createAssemblyBom({ assembly, occurrences, partAppearances: appearances })
    expect(rows[0]).toMatchObject({
      unitVolumeMm3: 1500,
      materialId: null,
      densityKgM3: null,
      unitMassG: null,
      totalMassG: null,
      appearancePresetIds: ["abs-white", "brass"],
    })
    expect(rows[1]?.appearancePresetIds).toEqual([])
  })

  it("multiplies exact volume by catalog density for unit and total mass", () => {
    const rows = createAssemblyBom({
      assembly,
      occurrences,
      materials: { [bracket]: "aluminum-6061-t6", [pin]: "steel-304" },
    })
    expect(rows[0]).toMatchObject({ densityKgM3: 2700, unitMassG: 1500 * 2700 * 1e-6 })
    expect(rows[1]?.unitMassG).toBeCloseTo(0.79, 12)
    expect(rows[1]?.totalMassG).toBeCloseTo(2.37, 12)
    expect(solidMassGrams(1_000_000, 1000)).toBe(1000)
  })

  it("refuses mass when any source is a mesh without exact volume", () => {
    const rows = createAssemblyBom({
      assembly,
      occurrences: occurrences.map((occurrence) =>
        occurrence.sourceIndex === 1 ? { ...occurrence, volumeMm3: undefined } : occurrence,
      ),
      materials: { [bracket]: "pla" },
    })
    expect(rows[0]).toMatchObject({ densityKgM3: 1240, unitVolumeMm3: null, unitMassG: null })
  })

  it("quotes CSV fields with commas, quotes and newlines per RFC 4180", () => {
    expect(csvField("plain")).toBe("plain")
    expect(csvField("a,b")).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField("two\nlines")).toBe('"two\nlines"')
    expect(csvField("cr\rlf")).toBe('"cr\rlf"')
  })

  it("formats a complete CSV with CRLF records and empty unknown values", () => {
    const csv = formatAssemblyBomCsv(
      createAssemblyBom({
        assembly,
        occurrences,
        partAppearances: appearances,
        materials: { [pin]: "steel-304" },
      }),
      labels,
    )
    expect(csv.startsWith(CSV_UTF8_BOM)).toBe(true)
    expect(csv.slice(CSV_UTF8_BOM.length)).toBe(
      [
        "Item,Part,Qty,Appearance,Material,Density (kg/m3),Unit volume (mm3),Unit mass (g),Total mass (g)",
        '1,"Bracket, ""left""\nrev B",1,abs-white; brass,,,1500,,',
        "2,Pin,3,,steel-304,7900,100,0.79,2.37",
        "",
      ].join("\r\n"),
    )
  })

  it.each([
    ["=", '=HYPERLINK("http://example.invalid","x")'],
    ["+", "+1-2"],
    ["-", "-2+3"],
    ["@", "@SUM(A1)"],
    ["tab", "\t=1+1"],
    ["CR", "\r=1+1"],
    ["LF", "\n=1+1"],
    ["NUL", "\0=1+1"],
    ["full-width =", '\uFF1DHYPERLINK("http://example.invalid")'],
    ["full-width +", "\uFF0B1-2"],
    ["full-width -", "\uFF0D2+3"],
    ["full-width @", "\uFF20SUM(A1)"],
  ])("prefixes an apostrophe to free text starting with %s", (_prefix, value) => {
    expect(spreadsheetText(value)).toBe(`'${value}`)
    const csv = formatAssemblyBomCsv(
      createAssemblyBom({
        assembly: { definitions: [{ ...pinDefinition, name: value }], instances: [pinInstance] },
        occurrences,
      }),
      { ...labels, appearance: () => value, material: () => value },
    )
    const record = csv.split("\r\n")[1] ?? ""
    expect(record.startsWith(`1,${csvField(`'${value}`)},1,`)).toBe(true)
    expect(record.split(`${csvField(`'${value}`)}`)).toHaveLength(4)
  })

  it("leaves ordinary text and numeric columns unchanged", () => {
    expect(spreadsheetText("Bracket - left")).toBe("Bracket - left")
    const csv = formatAssemblyBomCsv(
      createAssemblyBom({
        assembly: { definitions: [pinDefinition], instances: [pinInstance] },
        occurrences,
        materials: { [pin]: "steel-304" },
      }),
      labels,
    )
    expect(csv.split("\r\n")[1]).toBe("1,Pin,1,,steel-304,7900,100,0.79,0.79")
  })

  it("resolves live part appearance for frozen part sources", () => {
    expect(assemblySourceAppearances(assembly, appearances)).toEqual([
      {
        definitionId: bracket,
        sourceIndex: 0,
        appearance: { color: "#112233", roughness: 0.32, metalness: 0.86, opacity: 1 },
      },
      {
        definitionId: bracket,
        sourceIndex: 1,
        appearance: { color: "#eceeeb", roughness: 0.62, metalness: 0, opacity: 1 },
      },
      {
        definitionId: pin,
        sourceIndex: 0,
        appearance: { color: "#445566", roughness: 0.6, metalness: 0, opacity: 1 },
      },
    ])
  })
})
