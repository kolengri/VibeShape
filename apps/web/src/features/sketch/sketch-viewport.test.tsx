// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import {
  createLengthQuantity,
  createRectangleSketch,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  ActiveSketchSolveResult,
  DocumentControllerState,
} from "../../document/document-controller"
import { i18n } from "../../i18n"
import { SketchViewport } from "./sketch-viewport"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")

function sequentialIdFactory<Value>(parse: (value: string) => Value, group: string) {
  let index = 0
  return () => {
    index += 1
    return parse(`0195b5ac-${group}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

const sketch = createRectangleSketch({
  id: sketchId,
  label: "Sketch 1",
  plane: "xy",
  width: createLengthQuantity(30),
  height: createLengthQuantity(12),
  createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b241"),
  createConstraintId: sequentialIdFactory((value) => sketchConstraintIdSchema.parse(value), "b242"),
})
const pointEntities = sketch.entities.filter((entity) => entity.type === "point")
const controller = {
  status: "ready",
  report: {
    snapshot: { revision: 7, sketches: [sketch] },
    rebuild: { ok: true },
  },
} as unknown as DocumentControllerState

function solveResult(): ActiveSketchSolveResult {
  return {
    ok: true,
    response: {
      protocolVersion: 5,
      requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f32ff",
      documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f32fe",
      revision: 7,
      generation: 1,
      type: "sketchSolved",
      solution: {
        schemaVersion: 0,
        sketchId,
        sourceRevision: 7,
        status: "fully-constrained",
        degreesOfFreedom: 0,
        maximumResidual: 0,
        points: pointEntities.map(({ id, x, y }) => ({ entityId: id, x, y })),
        circles: [],
        failedConstraintIds: [],
        profileResult: {
          schemaVersion: 0,
          loops: [
            {
              loopIndex: 0,
              parentLoopIndex: null,
              depth: 0,
              signedArea: 360,
              perimeter: 84,
              bounds: { minX: 0, minY: 0, maxX: 30, maxY: 12 },
              sourceEntityIds: sketch.entities
                .filter((entity) => entity.type === "line")
                .map(({ id }) => id),
              segments: sketch.entities
                .filter((entity) => entity.type === "line")
                .map(({ id }) => ({ entityId: id, type: "line" as const, reversed: false })),
            },
          ],
          profiles: [
            {
              profileIndex: 0,
              outerLoopIndex: 0,
              holeLoopIndices: [],
              area: 360,
              perimeter: 84,
              bounds: { minX: 0, minY: 0, maxX: 30, maxY: 12 },
            },
          ],
          diagnostics: [],
        },
        heapCapacityBytes: 1_048_576,
        solverBuild: {
          schemaVersion: 0,
          solver: "SolveSpace",
          solverVersion: "3.2",
          sourceRevision: "27b6a080c8b669421bd4d444650c3b8eddec5687",
          abiVersion: 1,
          moduleSha256: "0".repeat(64),
          wasmSha256: "0".repeat(64),
        },
      },
    },
  }
}

function renderViewport(props: React.ComponentProps<typeof SketchViewport>) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <SketchViewport {...props} />
    </I18nProvider>,
  )
}

afterEach(cleanup)

describe("SketchViewport", () => {
  it("renders production solver state and exact profile measurements", async () => {
    const solveSketch = vi.fn(async () => solveResult())
    renderViewport({ controller, preview: null, sketch, solveSketch })

    expect(await screen.findByRole("img", { name: "Solved sketch geometry" })).toBeTruthy()
    expect(screen.getByText("Fully constrained")).toBeTruthy()
    expect(screen.getByText("Degrees of freedom: 0")).toBeTruthy()
    expect(screen.getByText("Profile: 360 mm² · 84 mm perimeter")).toBeTruthy()
    expect(solveSketch).toHaveBeenCalledWith(7, sketchId)
  })

  it("renders an explicit unsaved preview without invoking the worker", () => {
    const solveSketch = vi.fn(async () => solveResult())
    renderViewport({
      controller,
      preview: { width: 48, height: 20, plane: "yz" },
      sketch: null,
      solveSketch,
    })

    expect(screen.getByRole("img", { name: "Unsaved rectangular sketch preview" })).toBeTruthy()
    expect(screen.getByText("Unsaved preview")).toBeTruthy()
    expect(screen.getByText("YZ · millimeters")).toBeTruthy()
    expect(solveSketch).not.toHaveBeenCalled()
  })
})
