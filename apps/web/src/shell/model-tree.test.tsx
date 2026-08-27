// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  boxFeatureType,
  createEmptySketch,
  createLengthQuantity,
  datumPlaneFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
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
const datumFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2605"),
  type: datumPlaneFeatureType.type,
  parameters: {
    mode: "offset",
    support: { kind: "origin-plane", plane: "xz" },
    offset: createLengthQuantity(8),
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Offset plane",
})

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: { features: [feature], revision: 7, sketches: [sketch] },
  },
} as unknown as DocumentControllerState

function controllerWithBrokenSketchReference() {
  const source = createEmptySketch({
    id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2801"),
    label: "Source",
    plane: "xy",
  })
  const target = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2802",
    label: "Dependent",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2803",
        sourceSketchId: source.id,
        sourcePointId: sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2804"),
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2805",
      },
    ],
  })
  return {
    target,
    controller: {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature], revision: 8, sketches: [source, target] },
      },
    } as unknown as DocumentControllerState,
  }
}

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
    | "activeSketchId"
    | "activeWorkspace"
    | "controller"
    | "onFeatureActivate"
    | "onFeatureRename"
    | "onFeaturePreselectionChange"
    | "onFeatureVisibilityChange"
    | "onSketchActivate"
    | "onSketchDeleted"
    | "onSketchRemove"
    | "onSketchRename"
    | "onSketchVisibilityChange"
    | "onWorkspaceChange"
    | "sketchRenameBlockedId"
    | "hiddenFeatureIds"
    | "hiddenSketchIds"
  >
>

function renderTree({
  activeSketchId = null,
  activeWorkspace = "model",
  controller: treeController = controller,
  onFeatureActivate = vi.fn(),
  onFeatureRename = vi.fn().mockResolvedValue({ ok: true }),
  onFeaturePreselectionChange = vi.fn(),
  onFeatureVisibilityChange = vi.fn(),
  onSketchActivate = vi.fn(),
  onSketchDeleted = vi.fn(),
  onSketchRemove = vi.fn().mockResolvedValue({ ok: true }),
  onSketchRename = vi.fn().mockResolvedValue({ ok: true }),
  onSketchVisibilityChange = vi.fn(),
  onWorkspaceChange = vi.fn(),
  sketchRenameBlockedId = null,
  hiddenFeatureIds = [],
  hiddenSketchIds = [],
}: RenderTreeOptions = {}) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ModelTree
          activeFeatureId={featureId}
          activeSketchId={activeSketchId}
          activeWorkspace={activeWorkspace}
          controller={treeController}
          hiddenFeatureIds={hiddenFeatureIds}
          hiddenSketchIds={hiddenSketchIds}
          onFeatureActivate={onFeatureActivate}
          onFeatureRename={onFeatureRename}
          onFeaturePreselectionChange={onFeaturePreselectionChange}
          onFeatureVisibilityChange={onFeatureVisibilityChange}
          onSketchActivate={onSketchActivate}
          onSketchDeleted={onSketchDeleted}
          onSketchRemove={onSketchRemove}
          onSketchRename={onSketchRename}
          onSketchVisibilityChange={onSketchVisibilityChange}
          onWorkspaceChange={onWorkspaceChange}
          sketchRenameBlockedId={sketchRenameBlockedId}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
}

describe("ModelTree History presentation", () => {
  it("renders one graph-ordered History and terminal Bodies presentation", () => {
    const { container } = renderTree()

    expect(screen.getByRole("treeitem", { name: "History" })).toBeTruthy()
    expect(screen.getByRole("treeitem", { name: "Bodies" })).toBeTruthy()
    expect(screen.queryByRole("treeitem", { name: "Features" })).toBeNull()
    expect(screen.queryByRole("treeitem", { name: "Sketches" })).toBeNull()
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-history-id]")].map(
        (element) => `${element.dataset.historyKind}:${element.dataset.historyId}`,
      ),
    ).toEqual([`feature:${featureId}`, `sketch:${sketchId}`])
    expect(screen.getByRole("treeitem", { name: "Body 1" })).toBeTruthy()
    expect(screen.getByText("Result of Box 1")).toBeTruthy()
    expect(screen.getByRole("treeitem", { name: "Box 1" }).querySelector("svg")).toBeTruthy()
    expect(screen.getByText("Supported by XY plane")).toBeTruthy()
  })

  it("shows a transient rollback boundary only during active sketch editing", () => {
    const downstreamSketch = createEmptySketch({
      id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2604"),
      label: "Downstream profile",
      plane: "xz",
    })
    const editController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature], revision: 7, sketches: [sketch, downstreamSketch] },
      },
    } as unknown as DocumentControllerState
    const first = renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
      controller: editController,
    })

    expect(screen.getByText(/Rollback context/)).toBeTruthy()
    expect(
      first.container
        .querySelector(`[data-history-id="${downstreamSketch.id}"]`)
        ?.getAttribute("data-history-rolled-back"),
    ).toBe("true")

    first.unmount()
    const normal = renderTree({ controller: editController })
    expect(screen.queryByText(/Rollback context/)).toBeNull()
    expect(normal.container.querySelector("[data-history-rolled-back='true']")).toBeNull()
  })

  it("keeps datum geometry in History and out of Bodies", () => {
    const datumController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature, datumFeature], revision: 7, sketches: [sketch] },
      },
    } as unknown as DocumentControllerState
    const { container } = renderTree({ controller: datumController })

    expect(
      container
        .querySelector(`[data-history-id="${datumFeature.id}"]`)
        ?.getAttribute("data-history-feature-kind"),
    ).toBe("datum")
    expect(screen.getByRole("treeitem", { name: "Offset plane" }).querySelector("svg")).toBeTruthy()
    expect(screen.queryByText("Result of Offset plane")).toBeNull()
    expect(screen.getByText("Supported by XZ plane")).toBeTruthy()
  })
})

describe("ModelTree History disclosure", () => {
  it("collapses History and Bodies without leaving an active sketch", async () => {
    const user = userEvent.setup()
    const onWorkspaceChange = vi.fn()
    renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
      onWorkspaceChange,
    })

    const history = screen.getByRole("treeitem", { name: "History" })
    await user.click(history)
    expect(history.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("treeitem", { name: "Profile" })).toBeNull()

    await user.click(history)
    const bodies = screen.getByRole("treeitem", { name: "Bodies" })
    await user.click(bodies)
    expect(bodies.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("treeitem", { name: "Body 1" })).toBeNull()
    expect(onWorkspaceChange).not.toHaveBeenCalled()
  })

  it("navigates visible tree items and disclosure groups with the keyboard", async () => {
    const user = userEvent.setup()
    renderTree()

    const variables = screen.getByRole("treeitem", { name: "Variables" })
    variables.focus()
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}")
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "Box 1" }))

    await user.keyboard("{ArrowLeft}")
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "History" }))
    await user.keyboard("{ArrowLeft}")
    expect(screen.getByRole("treeitem", { name: "History" }).getAttribute("aria-expanded")).toBe(
      "false",
    )
  })
})

describe("ModelTree History failure", () => {
  it("exposes a bounded status instead of a rollback claim when graph ordering fails", () => {
    const invalidFeature = { ...feature, dependencies: [feature.id] }
    const invalidController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [invalidFeature], revision: 7, sketches: [sketch] },
      },
    } as unknown as DocumentControllerState
    const { container } = renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
      controller: invalidController,
    })

    expect(screen.getByRole("status").textContent).toContain("History ordering is unavailable")
    expect(screen.queryByText(/Rollback context/)).toBeNull()
    expect(container.querySelector("[data-history-rolled-back='true']")).toBeNull()
  })
})

describe("ModelTree selection", () => {
  it("exposes the active feature and activates it by stable feature identity", async () => {
    const user = userEvent.setup()
    const onFeatureActivate = vi.fn()

    renderTree({ onFeatureActivate })

    const featureItem = screen.getByRole("treeitem", { name: "Box 1" })
    expect(featureItem.getAttribute("aria-selected")).toBe("true")
    await user.click(featureItem)
    expect(onFeatureActivate).toHaveBeenCalledWith(featureId)
  })

  it("preselects feature geometry from pointer hover and keyboard focus", async () => {
    const user = userEvent.setup()
    const onFeaturePreselectionChange = vi.fn()
    renderTree({ onFeaturePreselectionChange })
    const featureItem = screen.getByRole("treeitem", { name: "Box 1" })

    await user.hover(featureItem)
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(featureId)
    await user.unhover(featureItem)
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(null)

    featureItem.focus()
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(featureId)
    featureItem.blur()
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(null)
  })

  it("enters the existing sketch editor from the model-tree sketch item", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()

    renderTree({ onSketchActivate })

    await user.click(screen.getByRole("treeitem", { name: "Profile" }))

    expect(onSketchActivate).toHaveBeenCalledWith(sketchId)
  })

  it("surfaces broken sketch references and opens the affected sketch for repair", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()
    const broken = controllerWithBrokenSketchReference()

    renderTree({ controller: broken.controller, onSketchActivate })

    expect(screen.getByText("Needs repair: 1 direct failure; no chained failures.")).toBeTruthy()
    const repair = screen.getByRole("button", {
      name: "Open Dependent to repair 1 broken reference",
    })
    expect(repair.querySelector("svg")).toBeTruthy()
    await user.click(repair)
    expect(onSketchActivate).toHaveBeenCalledWith(broken.target.id)
  })
})

describe("ModelTree visibility and deletion", () => {
  it("toggles terminal feature visibility from an icon-only accessible action", async () => {
    const user = userEvent.setup()
    const onFeatureVisibilityChange = vi.fn()
    const { unmount } = renderTree({ onFeatureVisibilityChange })

    await user.click(screen.getByRole("button", { name: "Hide Box 1" }))
    expect(onFeatureVisibilityChange).toHaveBeenCalledWith(featureId, false)

    unmount()
    renderTree({ hiddenFeatureIds: [featureId], onFeatureVisibilityChange })
    await user.click(screen.getByRole("button", { name: "Show Box 1" }))
    expect(onFeatureVisibilityChange).toHaveBeenLastCalledWith(featureId, true)
  })

  it("toggles saved sketch visibility without entering edit mode", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()
    const onSketchVisibilityChange = vi.fn()
    const { unmount } = renderTree({ onSketchActivate, onSketchVisibilityChange })

    await user.click(screen.getByRole("button", { name: "Hide Profile" }))

    expect(onSketchVisibilityChange).toHaveBeenCalledWith(sketchId, false)
    expect(onSketchActivate).not.toHaveBeenCalled()

    unmount()
    renderTree({ hiddenSketchIds: [sketchId], onSketchVisibilityChange })
    await user.click(screen.getByRole("button", { name: "Show Profile" }))
    expect(onSketchVisibilityChange).toHaveBeenLastCalledWith(sketchId, true)
  })

  it("confirms and removes an unused saved sketch by stable identity", async () => {
    const user = userEvent.setup()
    const onSketchDeleted = vi.fn()
    const onSketchRemove = vi.fn().mockResolvedValue({ ok: true })

    renderTree({ onSketchDeleted, onSketchRemove })

    await user.click(screen.getByRole("button", { name: "Delete Profile" }))
    await user.click(screen.getByRole("button", { name: "Delete sketch" }))

    expect(onSketchRemove).toHaveBeenCalledWith(7, sketchId)
    expect(onSketchDeleted).toHaveBeenCalledOnce()
  })
})

describe("ModelTree rename", () => {
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
