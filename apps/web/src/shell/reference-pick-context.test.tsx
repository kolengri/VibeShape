import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { type ReactNode, useLayoutEffect } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { ReferencePickField } from "../features/part-design/reference-pick-field"
import { i18n } from "../i18n"
import { ReferencePickProvider, useReferencePicking } from "./reference-pick-context"
import type { ReferencePickCandidate } from "./reference-picking"

afterEach(cleanup)

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([42]),
}
const candidates: readonly ReferencePickCandidate[] = [
  { id: "right", featureId: "split", kind: "body", outputRole: "right" },
]
const hit = { featureId: "split", outputRole: "right", faceId: 42, faceOrdinal: 1 }

function controller(revision = 7): DocumentControllerState {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      mode: "read-write",
      snapshot: {
        id: "document",
        revision,
        features: [{ id: "split", dependencies: [], suppressed: false }],
        sketches: [],
      },
      rebuild: {
        ok: true,
        response: {
          documentId: "document",
          revision,
          evaluation: {
            records: [{ featureId: "split", status: "succeeded", contentHash: "a".repeat(64) }],
            dirtyFeatureIds: [],
            evaluatedFeatureIds: [],
            reusedFeatureIds: [],
          },
          geometry: [
            {
              featureId: "split",
              contentHash: "a".repeat(64),
              geometry: {
                mesh,
                bodies: [
                  {
                    outputRole: "right",
                    shape: { valid: true, solidCount: 1, volume: 1 },
                    mesh,
                    topologyCandidates: [],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  } as unknown as DocumentControllerState
}

const requestTransitions = [
  "saving",
  "read-only",
  "revision",
  "rebuild",
  "hidden",
  "closed",
] as const
type RequestTransition = (typeof requestTransitions)[number]

function transitionedController(transition: RequestTransition, original: DocumentControllerState) {
  const originalReport = original.report
  if (!originalReport) throw new Error("Expected a ready picker report.")
  switch (transition) {
    case "revision":
      return controller(8)
    case "rebuild":
      return controller()
    case "saving":
      return { ...original, saveStatus: "saving" as const }
    case "read-only":
      return { ...original, report: { ...originalReport, mode: "read-only" as const } }
    default:
      return original
  }
}

let latest: ReturnType<typeof useReferencePicking> = null
function Probe() {
  const picker = useReferencePicking()
  useLayoutEffect(() => {
    latest = picker
  }, [picker])
  return null
}

function Fields({
  first = true,
  disabled = false,
  available = candidates,
  onFirst,
  onSecond,
}: {
  first?: boolean
  disabled?: boolean
  available?: readonly ReferencePickCandidate[]
  onFirst: (value: string) => void
  onSecond: (value: string) => void
}) {
  return (
    <>
      {first ? (
        <ReferencePickField
          id="first"
          label="End body"
          placeholder="Choose a body"
          value=""
          options={[]}
          candidates={available}
          disabled={disabled}
          onValueChange={onFirst}
        />
      ) : null}
      <ReferencePickField
        id="second"
        label="Tool body"
        placeholder="Choose a body"
        value=""
        options={[]}
        candidates={candidates}
        onValueChange={onSecond}
      />
      <button
        type="button"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault()
        }}
      >
        Nested gesture
      </button>
      <Probe />
    </>
  )
}

function App({
  state,
  activityKey = "extrude:create",
  hiddenFeatureIds = [],
  children,
}: {
  state: DocumentControllerState
  activityKey?: string | null
  hiddenFeatureIds?: readonly string[]
  children: ReactNode
}) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ReferencePickProvider
        controller={state}
        activityKey={activityKey}
        hiddenFeatureIds={hiddenFeatureIds}
      >
        {children}
      </ReferencePickProvider>
    </I18nProvider>
  )
}

describe("workspace reference picking", () => {
  it("switches ownership, ignores stale picks and old-owner unmount cleanup, and applies once", async () => {
    const user = userEvent.setup()
    const state = controller()
    const onFirst = mock(() => {})
    const onSecond = mock(() => {})
    const { rerender } = render(
      <App state={state}>
        <Fields onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    await user.click(screen.getByRole("button", { name: "Select End body in 3D" }))
    const stalePick = latest?.viewportContext?.faceIntersectionSelection?.onSelect
    await user.click(screen.getByRole("button", { name: "Select Tool body in 3D" }))
    rerender(
      <App state={state}>
        <Fields first={false} onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    act(() => stalePick?.(hit))
    expect(onFirst).toHaveBeenCalledTimes(0)
    expect(onSecond).toHaveBeenCalledTimes(0)
    expect(
      screen.getByRole("button", { name: "Select Tool body in 3D" }).getAttribute("aria-pressed"),
    ).toBe("true")
    const currentPick = latest?.viewportContext?.faceIntersectionSelection?.onSelect
    act(() => {
      currentPick?.(hit)
      currentPick?.(hit)
    })
    expect(onSecond).toHaveBeenCalledTimes(1)
    expect(onSecond).toHaveBeenCalledWith("right")
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Select Tool body in 3D" }),
    )
  })

  it("lets nested Escape finish first; the next Escape cancels only the picker", async () => {
    const user = userEvent.setup()
    const onFirst = mock(() => {})
    const onSecond = mock(() => {})
    const commandEscape = mock(() => {})
    render(
      <fieldset
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) commandEscape()
        }}
      >
        <App state={controller()}>
          <Fields onFirst={onFirst} onSecond={onSecond} />
        </App>
      </fieldset>,
    )
    const trigger = screen.getByRole("button", { name: "Select End body in 3D" })
    await user.click(trigger)
    fireEvent.keyDown(screen.getByRole("button", { name: "Nested gesture" }), { key: "Escape" })
    expect(trigger.getAttribute("aria-pressed")).toBe("true")
    // The ancestor models the existing document command cancellation and respects defaultPrevented.
    commandEscape.mockClear()
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(trigger.getAttribute("aria-pressed")).toBe("false")
    expect(onFirst).toHaveBeenCalledTimes(0)
    expect(commandEscape).toHaveBeenCalledTimes(0)
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(commandEscape).toHaveBeenCalledTimes(1)
  })

  it("keeps Escape in the field scope when pointer activation does not focus its button", async () => {
    const user = userEvent.setup()
    const commandEscape = mock(() => {})
    render(
      <fieldset
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) commandEscape()
        }}
      >
        <button type="button">Viewport toolbar action</button>
        <App state={controller()}>
          <Fields onFirst={() => {}} onSecond={() => {}} />
        </App>
      </fieldset>,
    )
    screen.getByRole("button", { name: "Viewport toolbar action" }).focus()
    const trigger = screen.getByRole("button", { name: "Select End body in 3D" })
    fireEvent.click(trigger)
    expect(trigger.getAttribute("aria-pressed")).toBe("true")
    expect(document.activeElement).toBe(trigger)
    await user.keyboard("{Escape}")
    expect(trigger.getAttribute("aria-pressed")).toBe("false")
    expect(document.activeElement).toBe(trigger)
    expect(commandEscape).not.toHaveBeenCalled()
  })

  it.each([...requestTransitions])(
    "invalidates the request on %s transitions and rejects its saved callback",
    async (transition) => {
      const user = userEvent.setup()
      const original = controller()
      const onFirst = mock(() => {})
      const onSecond = mock(() => {})
      const fields = <Fields onFirst={onFirst} onSecond={onSecond} />
      const { rerender } = render(<App state={original}>{fields}</App>)
      await user.click(screen.getByRole("button", { name: "Select End body in 3D" }))
      const stalePick = latest?.viewportContext?.faceIntersectionSelection?.onSelect
      rerender(
        <App
          state={transitionedController(transition, original)}
          hiddenFeatureIds={transition === "hidden" ? ["split"] : []}
          activityKey={transition === "closed" ? null : "extrude:create"}
        >
          {fields}
        </App>,
      )
      act(() => stalePick?.(hit))
      expect(onFirst).toHaveBeenCalledTimes(0)
      expect(latest?.viewportContext).toBeUndefined()
      expect(
        screen.getByRole("button", { name: "Select End body in 3D" }).getAttribute("aria-pressed"),
      ).toBe("false")
    },
  )

  it("cancels a disabled or removed field candidate and never reuses a pre-unmount callback", async () => {
    const user = userEvent.setup()
    const state = controller()
    const onFirst = mock(() => {})
    const onSecond = mock(() => {})
    const { rerender, unmount } = render(
      <App state={state}>
        <Fields onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    await user.click(screen.getByRole("button", { name: "Select End body in 3D" }))
    const stalePick = latest?.viewportContext?.faceIntersectionSelection?.onSelect
    rerender(
      <App state={state}>
        <Fields disabled onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    expect(latest?.viewportContext).toBeUndefined()
    act(() => stalePick?.(hit))
    rerender(
      <App state={state}>
        <Fields onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    await user.click(screen.getByRole("button", { name: "Select End body in 3D" }))
    rerender(
      <App state={state}>
        <Fields available={[]} onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    expect(latest?.viewportContext).toBeUndefined()
    rerender(
      <App state={state}>
        <Fields onFirst={onFirst} onSecond={onSecond} />
      </App>,
    )
    await user.click(screen.getByRole("button", { name: "Select End body in 3D" }))
    const unmountedPick = latest?.viewportContext?.faceIntersectionSelection?.onSelect
    unmount()
    act(() => {
      stalePick?.(hit)
      unmountedPick?.(hit)
    })
    expect(onFirst).toHaveBeenCalledTimes(0)
  })
})
