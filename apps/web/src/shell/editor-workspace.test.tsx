import "../../../../tests/unit/support/dom"

import { afterEach, describe, expect, it, mock } from "bun:test"
import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import { vi } from "../../../../tests/unit/support/bun-test"

// These tests own stack lifecycle; real tree interactions are covered by model-tree and browser tests.
mock.module("./model-tree", () => ({ ModelTree: () => null }))

const { cleanup, render, screen } = await import("@testing-library/react")
const { useEffect } = await import("react")
const { activeSketchDisplayForCamera, ModelingSketchViewportStack } = await import(
  "./editor-workspace"
)

afterEach(cleanup)

function ModelingLifecycleProbe({ onUnmount }: { onUnmount: () => void }) {
  useEffect(() => onUnmount, [onUnmount])
  return <div>Modeling viewport</div>
}

describe("ModelingSketchViewportStack", () => {
  it("preserves the modeling viewport while the sketch overlay enters and leaves", () => {
    const onUnmount = vi.fn()
    const element = (sketchActive: boolean) => (
      <ModelingSketchViewportStack
        modeling={<ModelingLifecycleProbe onUnmount={onUnmount} />}
        sketch={<div>Sketch overlay</div>}
        sketchActive={sketchActive}
      />
    )
    const view = render(element(false))

    expect(screen.getByText("Modeling viewport")).toBeTruthy()
    expect(screen.queryByText("Sketch overlay")).toBeNull()

    view.rerender(element(true))
    expect(screen.getByText("Modeling viewport")).toBeTruthy()
    expect(screen.getByText("Sketch overlay")).toBeTruthy()
    expect(onUnmount).not.toHaveBeenCalled()

    view.rerender(element(false))
    expect(screen.getByText("Modeling viewport")).toBeTruthy()
    expect(screen.queryByText("Sketch overlay")).toBeNull()
    expect(onUnmount).not.toHaveBeenCalled()

    view.unmount()
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })

  it("renders the active Three.js sketch display only in the orbit context", () => {
    const display = { sketchId: "active-sketch" } as unknown as SketchDisplayRecord

    expect(activeSketchDisplayForCamera(display, "normal")).toBeNull()
    expect(activeSketchDisplayForCamera(display, "orbit")).toBe(display)
    expect(activeSketchDisplayForCamera(display, "orbit", true)).toBeNull()
  })
})
