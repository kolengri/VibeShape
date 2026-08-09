// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { createDocumentExportFilename, downloadDocumentExport } from "./document-export"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("document export download", () => {
  it("creates portable filenames without discarding Unicode names", () => {
    expect(createDocumentExportFilename("Enclosure: left/right?* ", "step")).toBe(
      "Enclosure- left-right--.step",
    )
    expect(createDocumentExportFilename("  Корпус принтера  ", "stl")).toBe("Корпус принтера.stl")
    expect(createDocumentExportFilename("...", "step")).toBe("Untitled project.step")
  })

  it("downloads owned bytes with the matching media type and revokes the URL", () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:vibeshape-export")
    const revokeObjectURL = vi.fn((_url: string) => undefined)
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    vi.useFakeTimers()

    downloadDocumentExport({
      documentName: "Bracket",
      format: "stl",
      file: new Uint8Array([1, 2, 3]),
    })
    vi.runAllTimers()

    const blob = createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("model/stl")
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:vibeshape-export")
    expect(document.querySelector("a")).toBeNull()
  })
})
