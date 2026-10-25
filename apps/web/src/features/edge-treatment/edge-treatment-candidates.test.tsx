import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it, spyOn } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { i18n } from "../../i18n"
import {
  candidate,
  defaultProps,
  geometry,
  option,
  sourceId,
  treatmentId,
} from "./edge-treatment.test-fixtures"
import { edgeTreatmentCandidates, legacyEdgeReference } from "./edge-treatment-candidates"
import { EdgeTreatmentControls, type TreatmentControlsProps } from "./edge-treatment-controls"
import { EdgeTreatmentForm } from "./edge-treatment-form"
import { initialTreatmentValues } from "./edge-treatment-model"

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

it("resolves exact edges without approximate ranking and refreshes status with new evidence", () => {
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
    expect(rankings.read()).toBe(0)
    expect(edges[0]?.resolveStatus()).toBe("resolved")
    expect(rankings.read()).toBe(0)
    const first = candidate("edge")
    const updated = [
      option(sourceId, "result", "Body", [first, { ...first, candidateId: "duplicate" }]),
    ]
    const replacement = edgeTreatmentCandidates(updated, geometry(updated), () => "edge", "edge")
    expect(replacement[0]?.resolveStatus()).toBe("ambiguous")
    expect(edges[0]?.resolveStatus()).toBe("resolved")
    expect(rankings.read()).toBe(0)
  } finally {
    rankings.restore()
  }
})

it("shows only the open keyboard page and resolves exact choices without approximate ranking", async () => {
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
    expect(screen.queryByRole("button", { name: "Anonymous body · Edge 33" })).toBeNull()
    expect(rankings.read()).toBe(0)
    await userEvent.click(screen.getByRole("button", { name: /^Next$/ }))
    expect(screen.queryByRole("button", { name: "Anonymous body · Edge 1" })).toBeNull()
    expect(screen.getByRole("button", { name: "Anonymous body · Edge 33" })).toBeTruthy()
    expect(rankings.read()).toBe(0)
    await userEvent.click(screen.getByRole("button", { name: /^Previous$/ }))
    expect(screen.getByRole("button", { name: "Anonymous body · Edge 1" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Anonymous body · Edge 33" })).toBeNull()
    expect(rankings.read()).toBe(0)
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

it("shares row resolution across a mounted controls owner and replaces its index with candidate inputs", () => {
  const options = [
    option(
      sourceId,
      "result",
      "Body",
      Array.from({ length: 16 }, (_, index) => candidate("edge", index + 1)),
    ),
  ]
  const entries = edgeTreatmentCandidates(
    options,
    geometry(options),
    (_kind, ordinal) => `Edge ${ordinal}`,
    "edge",
  )
  let reads = 0
  const track = (label: string) =>
    entries.map((entry, index) => {
      const tracked = { ...entry, label: `${label} ${index + 1}` }
      // React's development prop diff must not read the resolution work counter.
      return Object.defineProperty(tracked, "candidate", {
        enumerable: false,
        get() {
          reads++
          return entry.candidate
        },
      })
    })
  const props: TreatmentControlsProps = {
    values: {
      ...initialTreatmentValues(
        { kind: "create", createFeatureId: () => treatmentId, featureLabel: "Fillet" },
        "fillet",
        options,
        "mm",
      ),
      references: entries.map(({ reference }) => {
        const result = legacyEdgeReference(reference)
        if (!result) throw new Error("The mounted fixture requires legacy edges.")
        return result
      }),
    },
    candidates: track("Original"),
    options,
    operation: "fillet",
    copy: defaultProps(options).copy,
    disabled: false,
    issues: {},
    suggestions: [],
    pick: null,
    onChange() {},
    onArm() {},
    onPick() {},
  }
  const controls = (value: TreatmentControlsProps) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <EdgeTreatmentControls {...value} />
    </I18nProvider>
  )
  const view = render(controls(props))
  expect(screen.getAllByRole("button", { name: /^Remove Original/ })).toHaveLength(16)
  expect(reads).toBe(16)
  view.rerender(controls({ ...props, values: { ...props.values, distance: "2 mm" } }))
  expect(reads).toBe(16)
  view.rerender(controls({ ...props, candidates: track("Replacement") }))
  expect(screen.getAllByRole("button", { name: /^Remove Replacement/ })).toHaveLength(16)
  expect(reads).toBe(32)
})
