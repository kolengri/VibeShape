import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createEmptySketch, sketchIdSchema } from "@vibeshape/domain"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import {
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import {
  HistoryNavigationControls,
  HistoryNavigationProvider,
  type HistoryNavigationProps as Props,
} from "./history-navigation"

afterEach(cleanup)

function fixture(position: number | null = null) {
  const { snapshot } = authoredTreeFixture()
  const first = requireAuthoredFixture(snapshot.features[0])
  const second = requireAuthoredFixture(snapshot.features[1])
  const sketch = createEmptySketch({
    id: sketchIdSchema.parse(authoredTestId(701)),
    label: "Profile",
    plane: "xy",
  })
  const items: HistoryItemRef[] = [
    { kind: "feature", id: first.id },
    { kind: "sketch", id: sketch.id },
    { kind: "feature", id: second.id },
  ]
  const controller: DocumentControllerState = {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      status: "created",
      mode: "read-write",
      snapshot: { ...snapshot, features: [first, second], sketches: [sketch] },
      historyItems: items,
      rebuild: {
        ok: false,
        diagnostic: {
          code: "rebuild-failed",
          message: "Navigation does not require geometry.",
          retryable: false,
          sourceCode: null,
        },
      },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
    historyInsertion:
      position === null
        ? null
        : {
            documentId: snapshot.id,
            baseRevision: snapshot.revision,
            historyAfter: position === 0 ? null : requireAuthoredFixture(items[position - 1]),
          },
  }
  return { controller, items }
}

function renderNavigation(position: number | null = null, options: Partial<Props> = {}) {
  const source = fixture(position)
  const onInsert = vi.fn<NonNullable<Props["onInsert"]>>().mockResolvedValue(true)
  const onReturnToEnd = vi.fn<NonNullable<Props["onReturnToEnd"]>>().mockResolvedValue(true)
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <HistoryNavigationProvider
          controller={source.controller}
          onInsert={onInsert}
          onReturnToEnd={onReturnToEnd}
          {...options}
        >
          <HistoryNavigationControls />
        </HistoryNavigationProvider>
      </TooltipProvider>
    </I18nProvider>,
  )
  return { ...source, onInsert, onReturnToEnd }
}

function navigation() {
  return within(screen.getByRole("group", { name: "History navigation" }))
}

function positionDescription() {
  return navigation().getByRole("status", { name: "History position" }).textContent
}

function feedback() {
  return (navigation().queryByRole("alert") ?? navigation().getByRole("status", { name: "" }))
    .textContent
}

describe("History transport", () => {
  it.each([
    {
      position: 0,
      description: "0 of 3: Start of History",
      firstDisabled: true,
      nextDisabled: false,
      lastDisabled: false,
    },
    {
      position: 2,
      description: "2 of 3: Profile",
      firstDisabled: false,
      nextDisabled: false,
      lastDisabled: false,
    },
    {
      position: null,
      description: "3 of 3: Full model",
      firstDisabled: false,
      nextDisabled: true,
      lastDisabled: true,
    },
  ])(
    "presents the cursor and reachable boundaries at $position",
    ({ position, description, firstDisabled, nextDisabled, lastDisabled }) => {
      renderNavigation(position)
      expect(positionDescription()).toBe(description)
      expect(navigation().queryByRole("slider")).toBeNull()
      expect(
        (navigation().getByRole("button", { name: "Roll back to the start" }) as HTMLButtonElement)
          .disabled,
      ).toBe(firstDisabled)
      expect(
        (navigation().getByRole("button", { name: "Step back one item" }) as HTMLButtonElement)
          .disabled,
      ).toBe(firstDisabled)
      expect(
        (navigation().getByRole("button", { name: "Step forward one item" }) as HTMLButtonElement)
          .disabled,
      ).toBe(nextDisabled)
      expect(
        (
          navigation().getByRole("button", {
            name: "Return to the full model",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(lastDisabled)
    },
  )

  it.each([
    { position: null, button: "Step back one item", target: 1, side: "below" },
    { position: 1, button: "Step forward one item", target: 1, side: "below" },
    { position: 2, button: "Step back one item", target: 0, side: "below" },
    { position: 2, button: "Roll back to the start", target: 0, side: "above" },
    { position: 0, button: "Step forward one item", target: 0, side: "below" },
  ] as const)(
    "seeks $button from $position through interleaved feature and sketch identities",
    async ({ position, button, target, side }) => {
      const { items, onInsert, onReturnToEnd } = renderNavigation(position)
      await userEvent.click(navigation().getByRole("button", { name: button }))
      expect(onInsert).toHaveBeenCalledTimes(1)
      expect(onInsert).toHaveBeenCalledWith(items[target], side)
      expect(onReturnToEnd).not.toHaveBeenCalled()
    },
  )

  it.each([2, 3])(
    "returns to full authority from cursor %s, including an explicit final-item cursor",
    async (position) => {
      const { onInsert, onReturnToEnd } = renderNavigation(position)
      await userEvent.click(navigation().getByRole("button", { name: "Return to the full model" }))
      expect(onReturnToEnd).toHaveBeenCalledTimes(1)
      expect(onInsert).not.toHaveBeenCalled()
    },
  )

  it("uses an early committed sketch as the effective position and keeps guarded forward and return available", async () => {
    const source = fixture()
    const edited = requireAuthoredFixture(source.controller.report?.snapshot.sketches[0])
    const onReturnToEnd = vi.fn<NonNullable<Props["onReturnToEnd"]>>().mockResolvedValue(false)
    const { onInsert } = renderNavigation(null, {
      activeWorkspace: "sketch",
      activeSketchId: edited.id,
      onReturnToEnd,
    })
    expect(positionDescription()).toBe("2 of 3: Profile")
    const next = navigation().getByRole("button", {
      name: "Step forward one item",
    }) as HTMLButtonElement
    const last = navigation().getByRole("button", {
      name: "Return to the full model",
    }) as HTMLButtonElement
    expect(next.disabled).toBe(false)
    expect(last.disabled).toBe(false)
    await userEvent.click(last)
    await waitFor(() => expect(feedback()).toContain("Resolve the active edit"))
    expect(positionDescription()).toBe("2 of 3: Profile")
    expect(onReturnToEnd).toHaveBeenCalledTimes(1)
    expect(onInsert).not.toHaveBeenCalled()
    await userEvent.click(next)
    await waitFor(() => expect(onReturnToEnd).toHaveBeenCalledTimes(2))
    expect(onInsert).not.toHaveBeenCalled()
  })

  it.each(["Step forward one item", "Return to the full model"])(
    "uses the guarded full-model action for %s while editing the final item",
    async (name) => {
      const source = fixture()
      const report = source.controller.report
      if (!report) throw new Error("Expected a navigation report.")
      const edited = requireAuthoredFixture(report.snapshot.sketches[0])
      const { onInsert, onReturnToEnd } = renderNavigation(null, {
        controller: {
          ...source.controller,
          report: {
            ...report,
            historyItems: [
              requireAuthoredFixture(source.items[0]),
              requireAuthoredFixture(source.items[2]),
              requireAuthoredFixture(source.items[1]),
            ],
          },
        },
        activeWorkspace: "sketch",
        activeSketchId: edited.id,
      })
      expect(positionDescription()).toBe("3 of 3: Profile")
      await userEvent.click(navigation().getByRole("button", { name }))
      expect(onReturnToEnd).toHaveBeenCalledTimes(1)
      expect(onInsert).not.toHaveBeenCalled()
    },
  )

  it("keeps an explicit insertion cursor ahead of the implicit edit position", () => {
    const source = fixture(1)
    const edited = requireAuthoredFixture(source.controller.report?.snapshot.sketches[0])
    renderNavigation(1, { activeWorkspace: "sketch", activeSketchId: edited.id })
    expect(positionDescription()).toBe("1 of 3: Box 1")
  })

  it("keeps a new uncommitted sketch at full authority", () => {
    renderNavigation(null, {
      activeWorkspace: "sketch",
      activeSketchId: sketchIdSchema.parse(authoredTestId(702)),
    })
    expect(positionDescription()).toBe("3 of 3: Full model")
    expect(
      (navigation().getByRole("button", { name: "Return to the full model" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it("shares one in-flight lock across transport buttons and releases it after fulfillment", async () => {
    let finish: ((result: boolean) => void) | undefined
    const onInsert = vi.fn<NonNullable<Props["onInsert"]>>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { onReturnToEnd } = renderNavigation(null, { onInsert })
    await userEvent.click(navigation().getByRole("button", { name: "Step back one item" }))
    expect(
      screen.getByRole("group", { name: "History navigation" }).getAttribute("aria-busy"),
    ).toBe("true")
    for (const button of navigation().getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(navigation().getByRole("button", { name: "Roll back to the start" }))
    fireEvent.click(navigation().getByRole("button", { name: "Return to the full model" }))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onReturnToEnd).not.toHaveBeenCalled()
    await act(async () => finish?.(true))
    expect(
      (navigation().getByRole("button", { name: "Step back one item" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    expect(
      screen.getByRole("group", { name: "History navigation" }).getAttribute("aria-busy"),
    ).toBe("false")
  })

  it.each(["guard", "rejection"])(
    "preserves the cursor after %s failure and allows retry",
    async (failure) => {
      const onInsert = vi.fn<NonNullable<Props["onInsert"]>>().mockResolvedValue(true)
      if (failure === "guard") onInsert.mockResolvedValueOnce(false)
      else onInsert.mockRejectedValueOnce(new Error("Saving the edit failed"))
      renderNavigation(null, { onInsert })
      const previous = navigation().getByRole("button", { name: "Step back one item" })
      await userEvent.click(previous)
      await waitFor(() =>
        expect(feedback()).toBe(
          "Could not move through History. Resolve the active edit and try again.",
        ),
      )
      expect(positionDescription()).toBe("3 of 3: Full model")
      await userEvent.click(previous)
      await waitFor(() => expect(feedback()).toBe(""))
      expect(onInsert).toHaveBeenCalledTimes(2)
    },
  )

  it.each(["read-only", "loading", "saving", "empty", "no insert", "no return"])(
    "disables transport when %s",
    async (reason) => {
      const source = fixture()
      const onInsert = vi.fn<NonNullable<Props["onInsert"]>>().mockResolvedValue(true)
      const onReturnToEnd = vi.fn<NonNullable<Props["onReturnToEnd"]>>().mockResolvedValue(true)
      if (!source.controller.report) throw new Error("Expected a navigation report.")
      renderNavigation(null, {
        controller: {
          ...source.controller,
          status: reason === "loading" ? "loading" : "ready",
          saveStatus: reason === "saving" ? "saving" : "saved",
          report: {
            ...source.controller.report,
            mode: reason === "read-only" ? "read-only" : "read-write",
            historyItems: reason === "empty" ? [] : source.items,
          },
        },
        onInsert: reason === "no insert" ? undefined : onInsert,
        onReturnToEnd: reason === "no return" ? undefined : onReturnToEnd,
      })
      for (const button of navigation().getAllByRole("button")) {
        expect((button as HTMLButtonElement).disabled).toBe(true)
        await userEvent.click(button)
      }
      expect(onInsert).not.toHaveBeenCalled()
      expect(onReturnToEnd).not.toHaveBeenCalled()
    },
  )
})
