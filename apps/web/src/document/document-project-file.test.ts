import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createProjectBackupFilename, downloadProjectBackup } from "./document-project-file"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("project backup download", () => {
  it("creates a portable .vshape filename", () => {
    expect(createProjectBackupFilename("Configurable: bracket? ")).toBe(
      "Configurable- bracket-.vshape",
    )
  })

  it("downloads owned bytes with the native project media type", () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:vibeshape-project")
    const revokeObjectURL = vi.fn((_url: string) => undefined)
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    vi.useFakeTimers()

    downloadProjectBackup({ documentName: "Bracket", file: new Uint8Array([1, 2, 3]) })
    vi.runAllTimers()

    const blob = createObjectURL.mock.calls[0]?.[0]
    expect(blob?.type).toBe("application/vnd.vibeshape.project+zip")
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:vibeshape-project")
    expect(document.querySelector("a")).toBeNull()
  })
})
