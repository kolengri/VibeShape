import "../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { ContextMenuTrigger } from "@vibeshape/ui/components/context-menu"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useContext } from "react"
import { builtInEditorCommandDescriptors } from "../commands/built-in-editor-commands"
import { editorCommandIds, type ResolvedEditorCommand } from "../commands/editor-command"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import {
  authoredTestBody,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import type { EditorWorkspaceActions } from "./editor-workspace"
import { ViewportContextMenu } from "./viewport-context-menu"
import {
  ViewportContextTargetContext,
  ViewportSelectionProperties,
} from "./viewport-context-target"

afterEach(cleanup)

function fixture(mode: "read-write" | "read-only") {
  const { authority, snapshot } = authoredTreeFixture()
  const part = requireAuthoredFixture(authority.parts[0])
  const sample = authoredTestBody(part)
  const body = { featureId: sample.featureId }
  const controller = {
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot: authority,
    report: {
      mode,
      snapshot,
      rebuild: {
        ok: true,
        response: {
          documentId: authority.id,
          revision: authority.revision,
          evaluation: {
            dirtyFeatureIds: [],
            evaluatedFeatureIds: snapshot.features.map(({ id }) => id),
            reusedFeatureIds: [],
            records: snapshot.features.map(({ id }) => ({
              featureId: id,
              status: "succeeded",
              contentHash: sample.contentHash,
            })),
          },
          geometry: snapshot.features.map(({ id }) => ({
            featureId: id,
            contentHash: sample.contentHash,
            meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
            geometry: {
              shape: sample.shape,
              mesh: sample.mesh,
              topologyCandidates: [],
              engine: {
                adapter: "replicad",
                adapterVersion: "test",
                replicadVersion: "0.23.1",
                opencascadePackageVersion: "0.23.0",
                opencascadeSourceRevision: null,
                wasmBytes: 1,
                initializedInMs: 1,
                featureContentEnvironment: {
                  schemaVersion: 0,
                  hostApiVersion: "0.1.0",
                  geometry: {
                    adapterId: "org.vibeshape.geometry.replicad",
                    adapterVersion: "test",
                    kernelId: "org.opencascade.occt",
                    kernelVersion: "0.23.0",
                    kernelSourceRevision: null,
                  },
                  modelingTolerancePolicyVersion: 1,
                  provider: { kind: "built-in" },
                },
              },
              cache: { brepHit: false },
              timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
            },
          })),
        },
      },
    },
  } as unknown as DocumentControllerState
  return { controller, body }
}

function Target({ candidates }: { candidates: readonly ViewerSelection[] }) {
  const context = useContext(ViewportContextTargetContext)
  return (
    <ContextMenuTrigger
      onContextMenu={(event) =>
        context?.request({
          face: null,
          candidates,
          focus: event.currentTarget,
          select: () => {},
          preview: () => {},
        })
      }
    >
      Model
    </ContextMenuTrigger>
  )
}

function renderMenu(
  mode: "read-write" | "read-only",
  commands: readonly ResolvedEditorCommand[] = [],
  faceOrdinals: readonly number[] = [],
) {
  const { controller, body } = fixture(mode)
  render(
    <I18nProvider i18n={i18n}>
      <ViewportContextMenu
        controller={controller}
        commands={commands}
        actions={{ select: () => {} } as unknown as EditorWorkspaceActions}
        enabled
        selectedBody={body}
        selection={null}
        partVisibility={undefined}
        hiddenFeatureIds={[]}
        onReveal={() => {}}
      >
        <Target
          candidates={faceOrdinals.map((faceOrdinal, index) => ({
            ...body,
            faceId: 100 + index,
            faceOrdinal,
          }))}
        />
        <ViewportSelectionProperties />
      </ViewportContextMenu>
    </I18nProvider>,
  )
}

it("shows the selected body's hashed default color rather than the first palette color", async () => {
  renderMenu("read-write")
  fireEvent.click(screen.getByRole("button", { name: "Properties" }))
  fireEvent.click(await screen.findByRole("button", { name: "Material and Color…" }))
  expect(screen.getByLabelText<HTMLInputElement>("Color", { exact: true }).value).toBe("#7ca5c7")
})

it("keeps Measure available in read-only documents while blocking model mutations", async () => {
  const measure = mock(() => {})
  const descriptor = requireAuthoredFixture(
    builtInEditorCommandDescriptors.find(({ id }) => id === editorCommandIds.measure),
  )
  renderMenu("read-only", [
    {
      descriptor,
      eligibility: { enabled: true },
      invoke: measure,
      toolbarVisible: true,
      active: false,
    },
  ])
  fireEvent.contextMenu(screen.getByText("Model"))
  const action = await screen.findByRole("menuitem", { name: "Measure" })
  expect(action.hasAttribute("data-disabled")).toBe(false)
  expect(screen.getByRole("menuitem", { name: "Edit Feature" }).hasAttribute("data-disabled")).toBe(
    true,
  )
  await act(async () => fireEvent.click(action))
  expect(measure).toHaveBeenCalledTimes(1)
})

it("preserves one-based face ordinals in overlapping-face menu labels", async () => {
  renderMenu("read-write", [], [1, 7])
  fireEvent.contextMenu(screen.getByText("Model"))
  const chooser = await screen.findByRole("menuitem", { name: "Select Other…" })
  fireEvent.keyDown(chooser, { key: "ArrowRight" })
  expect(await screen.findByRole("menuitem", { name: "Box 1 · Face 1" })).toBeTruthy()
  expect(screen.getByRole("menuitem", { name: "Box 1 · Face 7" })).toBeTruthy()
  expect(screen.queryByRole("menuitem", { name: "Box 1 · Face 2" })).toBeNull()
})
