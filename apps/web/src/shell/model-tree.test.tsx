// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  boxFeatureType,
  createEmptySketch,
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type { ComponentProps } from "react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { ModelTree } from "./model-tree"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20, "mm", "20 mm"),
    depth: createLengthQuantity(20, "mm", "20 mm"),
    height: createLengthQuantity(20, "mm", "20 mm"),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
})
const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2603")
const sketch = createEmptySketch({ id: sketchId, label: "Profile", plane: "xy" })

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: { features: [feature], revision: 7, sketches: [sketch] },
  },
} as unknown as DocumentControllerState

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

type ModelTreeProps = ComponentProps<typeof ModelTree>
type RenderTreeOptions = Partial<
  Pick<
    ModelTreeProps,
    "onFeatureActivate" | "onFeatureRename" | "onSketchRename" | "sketchRenameBlockedId"
  >
>

function renderTree({
  onFeatureActivate = vi.fn(),
  onFeatureRename = vi.fn().mockResolvedValue({ ok: true }),
  onSketchRename = vi.fn().mockResolvedValue({ ok: true }),
  sketchRenameBlockedId = null,
}: RenderTreeOptions = {}) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ModelTree
          activeFeatureId={featureId}
          activeSketchId={null}
          activeWorkspace="model"
          controller={controller}
          onFeatureActivate={onFeatureActivate}
          onFeatureRename={onFeatureRename}
          onSketchActivate={vi.fn()}
          onSketchRename={onSketchRename}
          onWorkspaceChange={vi.fn()}
          sketchRenameBlockedId={sketchRenameBlockedId}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
}

describe("ModelTree", () => {
  it("exposes the active feature and activates it by stable feature identity", async () => {
    const user = userEvent.setup()
    const onFeatureActivate = vi.fn()

    renderTree({ onFeatureActivate })

    const featureItem = screen.getByRole("treeitem", { name: "Box 1" })
    expect(featureItem.getAttribute("aria-selected")).toBe("true")
    await user.click(featureItem)
    expect(onFeatureActivate).toHaveBeenCalledWith(featureId)
  })

  it("renames a feature once from its discoverable model-tree action", async () => {
    const user = userEvent.setup()
    const onFeatureRename = vi.fn().mockResolvedValue({ ok: true })
    renderTree({ onFeatureRename })

    await user.click(screen.getByRole("button", { name: "Rename Box 1" }))
    await user.clear(screen.getByRole("textbox", { name: "Feature name" }))
    await user.type(screen.getByRole("textbox", { name: "Feature name" }), "Mounting block")
    await user.dblClick(screen.getByRole("button", { name: /^Rename feature$/ }))

    expect(onFeatureRename).toHaveBeenCalledOnce()
    expect(onFeatureRename).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: featureId, label: "Mounting block" }),
    )
  })

  it("opens sketch rename with F2 and blocks the sketch currently being edited", async () => {
    const user = userEvent.setup()
    const onSketchRename = vi.fn().mockResolvedValue({ ok: true })
    const { unmount } = renderTree({ onSketchRename })

    const sketchItem = screen.getByRole("treeitem", { name: "Profile" })
    sketchItem.focus()
    await user.keyboard("{F2}")
    await user.clear(screen.getByRole("textbox", { name: "Sketch name" }))
    await user.type(screen.getByRole("textbox", { name: "Sketch name" }), "Mounting profile")
    await user.click(screen.getByRole("button", { name: /^Rename sketch$/ }))
    expect(onSketchRename).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: sketchId, label: "Mounting profile" }),
    )

    unmount()
    renderTree({ sketchRenameBlockedId: sketchId })
    expect(
      (screen.getByRole("button", { name: "Rename Profile" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
