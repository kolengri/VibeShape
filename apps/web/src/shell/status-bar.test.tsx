import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import type { ComponentProps } from "react"
import type { DocumentControllerState } from "../document/document-controller"

mock.module("./automation-status", () => ({ AutomationStatus: () => null }))

const { cleanup, render, screen } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { authoredTestBody, authoredTreeFixture, requireAuthoredFixture } = await import(
  "../test-support/authored-tree-fixture"
)
const { StatusBar } = await import("./status-bar")
const { createEditorSessionStore } = await import("../editor-session/editor-session-store")

const fixture = authoredTreeFixture()
const feature = requireAuthoredFixture(fixture.snapshot.features[0])
const sample = authoredTestBody(requireAuthoredFixture(fixture.authority.parts[0]))

function controllerForRole(outputRole: string) {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      snapshot: fixture.snapshot,
      rebuild: {
        ok: true,
        response: {
          evaluation: {
            records: fixture.snapshot.features.map(({ id }) => ({
              featureId: id,
              status: "succeeded",
              contentHash: sample.contentHash,
            })),
            dirtyFeatureIds: [],
            evaluatedFeatureIds: [],
            reusedFeatureIds: [],
          },
          geometry: fixture.snapshot.features.map(({ id }) => ({
            featureId: id,
            contentHash: sample.contentHash,
            geometry: {
              shape: sample.shape,
              mesh: sample.mesh,
              topologyCandidates: [],
              bodies: [
                {
                  outputRole,
                  shape: sample.shape,
                  mesh: sample.mesh,
                  topologyCandidates: [],
                },
              ],
            },
          })),
        },
      },
    },
  } as unknown as DocumentControllerState
}

type StatusProps = Omit<ComponentProps<typeof StatusBar>, "controller">

function renderStatus(props: StatusProps, role = "result") {
  const element = (next: StatusProps) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <StatusBar controller={controllerForRole(role)} {...next} />
    </I18nProvider>
  )
  const view = render(element(props))
  return { ...view, rerenderStatus: (next: StatusProps) => view.rerender(element(next)) }
}

afterEach(cleanup)

describe("status selection semantics", () => {
  it.each(["result", "pattern.instance.0"])(
    "keeps a selected face more specific than its derived %s body summary",
    (outputRole) => {
      renderStatus(
        {
          selectedOriginPlane: null,
          selectedBody: { featureId: feature.id, outputRole },
          selection: { featureId: feature.id, outputRole, faceId: 42, faceOrdinal: 8 },
        },
        outputRole,
      )
      expect(screen.getByRole("status").textContent).toBe(
        outputRole === "result"
          ? "Selection: Box 1 · Face 8"
          : "Selection: Box 1 · Body 1 · Face 8",
      )
    },
  )

  it("keeps the body summary for a pure tree-body selection", () => {
    renderStatus({
      selectedOriginPlane: null,
      selectedBody: { featureId: feature.id, outputRole: "result" },
      selection: null,
    })
    expect(screen.getByRole("status").textContent).toBe("Selection: Box 1 · Body 1")
  })

  it("replaces the face summary after authoritative body and multiple-tree selection actions", () => {
    const store = createEditorSessionStore()
    const { actions } = store.getState()
    const body = { featureId: feature.id, outputRole: "result" }
    actions.setSelection({ ...body, faceId: 42, faceOrdinal: 8 })
    const view = renderStatus({
      selection: store.getState().selection,
      selectedBody: body,
      selectedOriginPlane: null,
    })
    expect(screen.getByRole("status").textContent).toBe("Selection: Box 1 · Face 8")

    const second = requireAuthoredFixture(fixture.snapshot.features[1])
    actions.setSelectedBody({ featureId: second.id, outputRole: "result" })
    let session = store.getState()
    expect(session.selection).toBeNull()
    view.rerenderStatus({
      selection: session.selection,
      selectedBody: session.selectedBody,
      selectedOriginPlane: session.selectedOriginPlane,
    })
    expect(screen.getByRole("status").textContent).toBe("Selection: Box 2 · Body 2")

    actions.setSelection({ ...body, faceId: 42, faceOrdinal: 8 })
    actions.setModelTreeSelection([
      { kind: "body", ...body },
      { kind: "body", featureId: second.id, outputRole: "result" },
    ])
    session = store.getState()
    expect(session.selection).toBeNull()
    expect(session.modelTreeSelection).toHaveLength(2)
    view.rerenderStatus({
      selection: session.selection,
      selectedBody: session.selectedBody,
      selectedOriginPlane: session.selectedOriginPlane,
    })
    expect(screen.getByRole("status").textContent).toBe("Selection: None")
  })

  it("keeps origin-plane and empty-selection labels without a semantic face or body", () => {
    const view = renderStatus({ selectedOriginPlane: "xz", selection: null })
    expect(screen.getByRole("status").textContent).toBe("Selection: XZ plane")
    view.rerenderStatus({ selectedOriginPlane: null, selection: null })
    expect(screen.getByRole("status").textContent).toBe("Selection: None")
  })
})
