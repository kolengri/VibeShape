import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render } from "@testing-library/react"
import { createLengthQuantity, featureRecordSchema } from "@vibeshape/domain"
import { fdmFeatureType } from "@vibeshape/domain/part-design-fdm"
import { HistoryFeatureIcon } from "./history-feature-icon"

afterEach(cleanup)

function feature(parameters: unknown) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f8100",
    type: fdmFeatureType.type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

it("shows the saved FDM subtool in History instead of the shell operation", () => {
  const record = feature({
    kind: "calibration-coupon",
    axis: "Z",
    origin: { x: createLengthQuantity(0), y: createLengthQuantity(0), z: createLengthQuantity(0) },
    diameterStart: createLengthQuantity(4),
    diameterStep: createLengthQuantity(0.1),
    holeCount: 5,
    spacing: createLengthQuantity(8),
    thickness: createLengthQuantity(3),
    margin: createLengthQuantity(2),
  })
  const { container } = render(<HistoryFeatureIcon feature={record} />)
  expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe("fdm-calibration-coupon")
})

it("uses generic FDM artwork when saved parameters cannot establish a valid subtool", () => {
  const { container } = render(<HistoryFeatureIcon feature={feature({ kind: "insert-pocket" })} />)
  expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe("fdm-tools")
})
