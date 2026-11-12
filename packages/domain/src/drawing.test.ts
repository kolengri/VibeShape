import { describe, expect, it } from "bun:test"
import { drawingSettingsSchema, stripDrawingControlCharacters } from "./drawing"

describe("drawing title block text", () => {
  it.each([
    "\u0007",
    "\u000b",
    "\u0000",
    "\u001f",
    "\u007f",
    "\uFFFE",
    "\uFFFF",
    "\uD800",
    "\uDC00",
  ])("rejects the character %j that XML 1.0 forbids in every field", (control) => {
    for (const field of ["title", "drawingNumber", "author", "date", "material"])
      expect(
        drawingSettingsSchema.safeParse({ titleBlock: { [field]: `A${control}B` } }).success,
      ).toBe(false)
  })

  it("accepts printable Unicode, including symbols and non-Latin scripts", () => {
    const title = "Кронштейн Ø10 € – — …"
    expect(drawingSettingsSchema.parse({ titleBlock: { title } }).titleBlock.title).toBe(title)
  })

  it("strips control characters from typed or pasted text", () => {
    expect(stripDrawingControlCharacters("Bracket\u0007\u000b v2\u007f")).toBe("Bracket v2")
    expect(stripDrawingControlCharacters("A\uFFFEB\uFFFFC\uD800D\uDC00E 😀")).toBe("ABCDE 😀")
  })
})
