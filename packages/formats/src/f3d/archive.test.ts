import { describe, expect, it } from "bun:test"
import { zipSync } from "fflate"
import { unzip } from "./archive"
import { F3dFormatError } from "./bytes"
import { prepareF3dImport } from "./index"

const path = "Asset/Design1/MetaStream.dat"
function archive() {
  return zipSync({ [path]: Uint8Array.of(1, 2, 3, 4) }, { level: 0 })
}
function central(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer)
  return view.getUint32(bytes.length - 6, true)
}
describe("bounded F3D archives", () => {
  it("reads stored and deflated entries without extracting files", () => {
    for (const level of [0, 6] as const) {
      const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 23)
      expect(unzip(zipSync({ [path]: data }, { level })).get(path)).toEqual(data)
    }
  })
  it("rejects corrupted content and inconsistent declared sizes", () => {
    const content = archive()
    content[30 + path.length] = 255
    expect(() => unzip(content)).toThrow(/checksum/)
    const declared = archive()
    new DataView(declared.buffer).setUint32(central(declared) + 24, 999, true)
    expect(() => unzip(declared)).toThrow(/Wrong size/)
  })
  it("rejects paths, duplicate entries, encrypted streams and split archives", () => {
    expect(() => unzip(zipSync({ "../Design1/MetaStream.dat": Uint8Array.of(1) }))).toThrow(
      /Unsafe/,
    )
    const duplicate = zipSync({
      "A/Design1/MetaStream.dat": Uint8Array.of(1),
      "B/Design1/MetaStream.dat": Uint8Array.of(2),
    })
    const text = new TextEncoder().encode("B/Design1/MetaStream.dat")
    for (let i = 0; i <= duplicate.length - text.length; i++)
      if (text.every((b, n) => duplicate[i + n] === b)) duplicate[i] = 65
    expect(() => unzip(duplicate)).toThrow(/Duplicate/)
    const encrypted = archive()
    new DataView(encrypted.buffer).setUint16(central(encrypted) + 8, 1, true)
    expect(() => unzip(encrypted)).toThrow(/Encrypted/)
    const split = archive()
    new DataView(split.buffer).setUint16(split.length - 18, 1, true)
    expect(() => unzip(split)).toThrow(/split/)
  })
  it("rejects huge declared sizes before decompressing and invalid directory ranges", () => {
    const bomb = archive()
    new DataView(bomb.buffer).setUint32(central(bomb) + 24, 0x40000000, true)
    expect(() => unzip(bomb)).toThrow(/too large/)
    const range = archive()
    new DataView(range.buffer).setUint32(range.length - 6, range.length, true)
    expect(() => unzip(range)).toThrow(/extent/)
  })
  it("rejects malformed design data without claiming a successful import", () => {
    expect(() => prepareF3dImport(Uint8Array.of(1, 2, 3))).toThrow(F3dFormatError)
    expect(() => prepareF3dImport(archive())).toThrow(F3dFormatError)
  })
})

it("prepares a complete license-safe archive with exact fallback and editable records", async () => {
  const bytes = new Uint8Array(
    await Bun.file(
      new URL("../../tests/fixtures/f3d/synthetic-box.f3d", import.meta.url),
    ).arrayBuffer(),
  )
  const result = prepareF3dImport(bytes)
  expect(result.report).toMatchObject({
    recoveredBodies: 1,
    editableSketches: 1,
    numericParameters: 1,
  })
  expect(result.parameters).toEqual([{ name: "width", expression: "15 mm" }])
  expect(result.sketches[0]?.curves).toEqual([{ type: "circle", center: [0, 0], radius: 5 }])
  expect(result.report.unsupported.some((issue) => issue.name === "Unsupported1")).toBe(true)
  expect(result.step).toContain("MANIFOLD_SOLID_BREP")
})

it("reads modern method-93 Zstandard entries and refuses unsafe windows and dictionaries", () => {
  const data = Uint8Array.of(1, 2, 3)
  const frame = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x20, 3, 25, 0, 0, ...data)
  function zstdArchive(content: Uint8Array) {
    const zip = zipSync({ [path]: content }, { level: 0 })
    // Use the CRC for [1,2,3], not the framing bytes.
    const dataZip = zipSync({ [path]: data }, { level: 0 })
    const dataCrc = new DataView(dataZip.buffer).getUint32(central(dataZip) + 16, true)
    const view = new DataView(zip.buffer),
      directory = central(zip)
    view.setUint16(8, 93, true)
    view.setUint16(directory + 10, 93, true)
    view.setUint32(22, data.length, true)
    view.setUint32(directory + 24, data.length, true)
    view.setUint32(14, dataCrc, true)
    view.setUint32(directory + 16, dataCrc, true)
    return zip
  }
  expect(unzip(zstdArchive(frame)).get(path)).toEqual(data)
  const window = Uint8Array.from(frame)
  window[4] = 0
  window[5] = 0xf8
  expect(() => unzip(zstdArchive(window))).toThrow(/window/)
  const dictionary = Uint8Array.from(frame)
  dictionary[4] = 0x21
  expect(() => unzip(zstdArchive(dictionary))).toThrow(/dictionary/)
})

it("resolves BREP geometry inside the active asset despite a cross-asset basename collision", async () => {
  const bytes = new Uint8Array(
    await Bun.file(
      new URL("../../tests/fixtures/f3d/synthetic-box.f3d", import.meta.url),
    ).arrayBuffer(),
  )
  const baseline = prepareF3dImport(bytes)
  const entries = unzip(bytes)
  const brepName = [...entries.keys()].find((name) => name.includes("/Breps.BlobParts/"))
  if (!brepName) throw new Error("The fixture must contain an exact body stream.")
  const basename = brepName.slice(brepName.lastIndexOf("/") + 1)
  const collision = zipSync(
    Object.fromEntries([
      [`InactiveAsset/Breps.BlobParts/${basename}`, Uint8Array.of(1, 2, 3)],
      ...entries,
    ]),
  )
  const prepared = prepareF3dImport(collision)
  expect(prepared.step).toBe(baseline.step)
  expect(prepared.report.recoveredBodies).toBe(baseline.report.recoveredBodies)
})

it("recovers root-level Design1 assets with the same exact geometry and editable records", async () => {
  const bytes = new Uint8Array(
    await Bun.file(
      new URL("../../tests/fixtures/f3d/synthetic-box.f3d", import.meta.url),
    ).arrayBuffer(),
  )
  const baseline = prepareF3dImport(bytes)
  const entries = unzip(bytes)
  const rootLayout = zipSync(
    Object.fromEntries([...entries].map(([name, data]) => [name.replace(/^Asset\//, ""), data])),
  )
  const prepared = prepareF3dImport(rootLayout)
  expect(prepared.step).toBe(baseline.step)
  expect(prepared.report).toEqual(baseline.report)
  expect(prepared.sketches).toEqual(baseline.sketches)
})
