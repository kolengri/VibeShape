import { describe, expect, it } from "vitest"

import { compareMessageCatalogs, mergeMessages } from "./catalog"

describe("message catalogs", () => {
  it("merges independently owned top-level namespaces without mutating the inputs", () => {
    const app = { app: { title: "VibeShape" } }
    const ui = { ui: { loading: "Loading" } }

    const merged = mergeMessages(app, ui)

    expect(merged).toEqual({ ...app, ...ui })
    expect(app).toEqual({ app: { title: "VibeShape" } })
    expect(ui).toEqual({ ui: { loading: "Loading" } })
  })

  it("rejects duplicate top-level namespace ownership", () => {
    expect(() =>
      mergeMessages({ app: { title: "VibeShape" } }, { app: { ready: "Ready" } }),
    ).toThrow("Duplicate top-level message namespace: app")
  })

  it("reports missing, extra, and placeholder differences against English", () => {
    const english = {
      shell: {
        ready: "Ready",
        units: "Units: {unit}",
      },
    }
    const candidate = {
      shell: {
        extra: "Extra",
        units: "Units: {symbol}",
      },
    }

    expect(compareMessageCatalogs(english, candidate)).toEqual([
      { key: "shell.ready", type: "missing-key" },
      {
        actual: ["{symbol}"],
        expected: ["{unit}"],
        key: "shell.units",
        type: "placeholder-mismatch",
      },
      { key: "shell.extra", type: "extra-key" },
    ])
  })

  it("compares arguments in nested ICU plural messages", () => {
    const english = {
      files: "{count, plural, one {# file for {owner}} other {# files for {owner}}}",
    }
    const candidate = {
      files: "{quantity, plural, one {# file for {owner}} other {# files for {owner}}}",
    }

    expect(compareMessageCatalogs(english, candidate)).toEqual([
      {
        actual: ["{owner}", "{owner}", "{quantity}"],
        expected: ["{count}", "{owner}", "{owner}"],
        key: "files",
        type: "placeholder-mismatch",
      },
    ])
  })
})
