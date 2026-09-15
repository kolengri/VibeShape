import { describe, expect, it } from "vitest"
import { resolveSelectedEdgeKeys } from "./selected-edge-resolver"

describe("exact selected-edge acquisition", () => {
  it("maps resolved candidates within the owned shape snapshot", () => {
    expect(
      resolveSelectedEdgeKeys(
        ["edge:9", "edge:2"],
        new Map([
          ["edge:2", 42],
          ["edge:9", 71],
        ]),
      ),
    ).toEqual([71, 42])
  })
  it.each(["edge:missing", "face:0"])("rejects unavailable or non-edge selection %s", (id) => {
    expect(() => resolveSelectedEdgeKeys([id], new Map([["face:0", 3]]))).toThrow("unavailable")
  })
  it("rejects duplicate native hashes even for distinct candidate IDs", () => {
    expect(() =>
      resolveSelectedEdgeKeys(
        ["edge:0", "edge:1"],
        new Map([
          ["edge:0", 4],
          ["edge:1", 4],
        ]),
      ),
    ).toThrow("duplicate")
  })
  it("rejects empty and oversized selection sets", () => {
    expect(() => resolveSelectedEdgeKeys([], new Map())).toThrow("count")
    expect(() =>
      resolveSelectedEdgeKeys(
        Array.from({ length: 257 }, (_, i) => `edge:${i}`),
        new Map(),
      ),
    ).toThrow("count")
  })
})
