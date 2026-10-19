import { describe, expect, it } from "bun:test"
import { canSendNativeEvent, chosenNativeFile } from "./native-window-policy"

describe("native window delivery policy", () => {
  const owned = "http://127.0.0.1:43115/?project=fixture"
  const owns = (url: string) => url === owned
  const contents = (url: string, destroyed = false) => ({
    getURL: () => url,
    isDestroyed: () => destroyed,
  })
  it("sends only to a live owned editor while the app is running", () => {
    expect(canSendNativeEvent(contents(owned), false, owns)).toBe(true)
    expect(canSendNativeEvent(contents(owned), true, owns)).toBe(false)
    expect(canSendNativeEvent(contents(owned, true), false, owns)).toBe(false)
    expect(canSendNativeEvent(contents("https://example.com"), false, owns)).toBe(false)
    expect(canSendNativeEvent(undefined, false, owns)).toBe(false)
  })
  it("never treats a cancelled or empty native picker as a selected file", () => {
    expect(chosenNativeFile({ canceled: true, filePaths: ["/private/ignored"] })).toBeNull()
    expect(chosenNativeFile({ canceled: false, filePaths: [] })).toBeNull()
    expect(chosenNativeFile({ canceled: false, filePaths: ["/Applications/Fixture.app"] })).toBe(
      "/Applications/Fixture.app",
    )
  })
})
