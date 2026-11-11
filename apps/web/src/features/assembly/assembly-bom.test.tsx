import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { AssemblyBomAuthority } from "@vibeshape/domain/assembly-bom"
import type { PartAppearance } from "@vibeshape/domain/part-appearance"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"

const download = vi.fn<(name: string, suffix: string, content: string | Uint8Array) => void>()
const actualExport = { ...(await import("./assembly-motion-export")) }
mock.module("./assembly-motion-export", () => ({
  ...actualExport,
  downloadAssemblyMotion: download,
}))
const { cleanup, render, screen, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../../i18n")
const { AssemblyBom } = await import("./assembly-bom")

const id = (n: number) => `01950000-0000-7000-8000-${String(n).padStart(12, "0")}`
const source = (partId: string) =>
  ({
    kind: "part",
    partId,
    body: { schemaVersion: 0, featureId: partId, outputRole: "body" },
    contentHash: "a".repeat(64),
  }) as unknown as AssemblyBomAuthority["definitions"][number]["sources"][number]
const assembly: AssemblyBomAuthority = {
  definitions: [
    { id: id(1), name: 'Plate, "A"', sources: [source("part-a")] },
    { id: id(2), name: "Bolt", sources: [source("part-b")] },
  ],
  instances: [{ definitionId: id(1) }, { definitionId: id(2) }, { definitionId: id(2) }],
}
const inspection = {
  occurrences: [
    { instanceId: id(10), definitionId: id(1), sourceIndex: 0, volume: 2000 },
    { instanceId: id(11), definitionId: id(2), sourceIndex: 0, volume: 100 },
    { instanceId: id(12), definitionId: id(2), sourceIndex: 0, volume: 100 },
  ],
  interference: [],
} as unknown as AssemblyInspection
const appearances = [
  { partId: "part-a", appearance: { presetId: "brass" } },
] as unknown as PartAppearance[]

function renderBom(props: Partial<Parameters<typeof AssemblyBom>[0]> = {}) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssemblyBom
        assembly={assembly}
        partAppearances={appearances}
        inspection={inspection}
        pending={false}
        documentName="Fixture"
        {...props}
      />
    </I18nProvider>,
  )
}

beforeEach(() => download.mockReset())
afterEach(cleanup)

describe("assembly bill of materials view", () => {
  it("lists each definition with quantity, appearance and unknown mass in an accessible table", async () => {
    const user = userEvent.setup()
    renderBom()
    await user.click(screen.getByRole("button", { name: "Show bill of materials" }))
    const table = screen.getByRole("table", { name: "Assembly bill of materials" })
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent)
    expect(headers).toEqual([
      "Item",
      "Part",
      "Qty",
      "Appearance",
      "Material",
      "Unit mass",
      "Total mass",
    ])
    const bolt = within(table).getByRole("rowheader", { name: "Bolt" }).closest("tr")
    if (!bolt) throw new Error("missing row")
    expect(
      within(bolt)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["2", "2", "—", expect.stringContaining("Not set"), "—", "—"])
    expect(
      (within(bolt).getByRole("combobox", { name: "Material for Bolt" }) as HTMLSelectElement)
        .value,
    ).toBe("none")
    expect(
      within(table).getByRole("rowheader", { name: 'Plate, "A"' }).closest("tr")?.textContent,
    ).toContain("Brass")
  })

  it("computes mass only after an explicit material choice and exports quoted CSV", async () => {
    const user = userEvent.setup()
    renderBom()
    await user.click(screen.getByRole("button", { name: "Show bill of materials" }))
    const select = screen.getByRole("combobox", { name: "Material for Bolt" })
    await user.selectOptions(select, "steel-304")
    const bolt = screen.getByRole("rowheader", { name: "Bolt" }).closest("tr")
    if (!bolt) throw new Error("missing row")
    expect(bolt.textContent).toContain("0.79 g")
    expect(bolt.textContent).toContain("1.58 g")
    await user.click(screen.getByRole("button", { name: "Download CSV" }))
    expect(download).toHaveBeenCalledTimes(1)
    const [name, suffix, csv] = download.mock.calls[0] ?? []
    expect([name, suffix]).toEqual(["Fixture BOM", "csv"])
    expect(String(csv).split("\r\n")).toEqual([
      "Item,Part,Qty,Appearance,Material,Density (kg/m³),Unit volume (mm³),Unit mass (g),Total mass (g)",
      '1,"Plate, ""A""",1,Brass,,,2000,,',
      "2,Bolt,2,,Stainless steel 304 — Outokumpu,7900,100,0.79,1.58",
      "",
    ])
  })

  it("shows a measuring status before exact volumes arrive and an empty state without instances", async () => {
    const user = userEvent.setup()
    const view = renderBom({ inspection: null, pending: true })
    await user.click(screen.getByRole("button", { name: "Show bill of materials" }))
    expect(screen.getByRole("status").textContent).toBe("Measuring exact volumes…")
    view.unmount()
    renderBom({ assembly: { definitions: assembly.definitions, instances: [] } })
    await user.click(screen.getByRole("button", { name: "Show bill of materials" }))
    expect(screen.getByText("The assembly has no instances to list.")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Download CSV" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
