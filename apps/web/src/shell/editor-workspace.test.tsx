// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModelingSketchViewportStack } from "./editor-workspace"

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
    expect(onUnmount).toHaveBeenCalledOnce()
  })
})
