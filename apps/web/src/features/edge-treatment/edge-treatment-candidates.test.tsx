import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it, spyOn } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { i18n } from "../../i18n"
import { candidate, defaultProps, geometry, option, sourceId } from "./edge-treatment.test-fixtures"
import { edgeTreatmentCandidates } from "./edge-treatment-candidates"
import { EdgeTreatmentForm } from "./edge-treatment-form"

afterEach(cleanup)

function catalogue() {
  const edges = Array.from({ length: 256 }, (_, index) => candidate("edge", index + 1))
  const faces = Array.from({ length: 256 }, (_, index) => candidate("face", index + 1))
  return [option(sourceId, "result", "Anonymous body", edges, faces)]
}

function countRankings() {
  let count = 0
  const original = Array.prototype.sort
  const spy = spyOn(Array.prototype, "sort").mockImplementation(function (
    this: unknown[],
    compare?: (left: unknown, right: unknown) => number,
  ) {
    if (this.length === 256) count++
    return original.call(this, compare)
  })
  return { read: () => count, restore: () => spy.mockRestore() }
}

it("does no eager ranking, resolves only requested edges, and discards the cache with its evidence", () => {
  const options = catalogue()
  const models = geometry(options)
  const rankings = countRankings()
  try {
    const edges = edgeTreatmentCandidates(
      options,
      models,
      (kind, ordinal) => `${kind} ${ordinal}`,
      "edge",
    )
    expect(edges).toHaveLength(256)
    expect(edges.every(({ reference }) => reference.kind === "edge")).toBe(true)
    expect(rankings.read()).toBe(0)
    expect(edges[0]?.resolveStatus()).toBe("resolved")
    expect(rankings.read()).toBe(1)
    expect(edges[0]?.resolveStatus()).toBe("resolved")
    expect(rankings.read()).toBe(1)
    const replacement = edgeTreatmentCandidates(options, models, () => "edge", "edge")
    expect(replacement[0]?.resolveStatus()).toBe("resolved")
    expect(rankings.read()).toBe(2)
  } finally {
    rankings.restore()
  }
})

it("ranks only the open keyboard page and reuses status when returning to it", async () => {
  const options = catalogue()
  const rankings = countRankings()
  try {
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <EdgeTreatmentForm {...defaultProps(options)} />
      </I18nProvider>,
    )
    expect(rankings.read()).toBe(0)
    await userEvent.click(screen.getByText("Keyboard choices", { selector: "summary" }))
    await screen.findByRole("button", { name: "Anonymous body · Edge 1" })
    expect(rankings.read()).toBe(32)
    await userEvent.click(screen.getByRole("button", { name: /^Next$/ }))
    expect(rankings.read()).toBe(64)
    await userEvent.click(screen.getByRole("button", { name: /^Previous$/ }))
    expect(rankings.read()).toBe(64)
  } finally {
    rankings.restore()
  }
})

it("keeps anonymous signature ambiguity conservative when resolution is requested", () => {
  const first = candidate("edge")
  const options = [
    option(sourceId, "result", "Body", [first, { ...first, candidateId: "other-edge" }]),
  ]
  const edges = edgeTreatmentCandidates(options, geometry(options), () => "edge", "edge")
  expect(edges[0]?.resolveStatus()).toBe("ambiguous")
  expect(edges[1]?.resolveStatus()).toBe("ambiguous")
})
