import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import {
  type HistoryReviewInput,
  historyRequestSchema,
} from "@vibeshape/automation-host/history-session"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import {
  type SurfaceTextureReviewInput,
  surfaceTextureCommandSchema,
} from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { commandActorSchema, documentCommandSchema } from "@vibeshape/domain/commands"
import { historyItemRefSchema } from "@vibeshape/domain/document-node"
import { documentSnapshotV2Schema } from "@vibeshape/domain/document-v2"
import { documentV2MetadataChangeSchema } from "@vibeshape/domain/document-v2-command-schemas"
import { moveHistoryItemCommandSchema } from "@vibeshape/domain/history-document-commands"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { I18nProvider } from "@vibeshape/i18n/provider"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
} from "../../../../tests/fixtures/surface-texture-project"
import { vi } from "../../../../tests/unit/support/bun-test"
import * as texturePreview from "../features/surface-texture/surface-texture-preview-context"
import { i18n } from "../i18n"
import { automationReviews } from "./automation-review-controller"
import { AutomationReviewPanel } from "./automation-review-panel"
import type { AutomationReviewState } from "./automation-review-state"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const review = (
  status: "ready" | "error" | "applying" = "ready",
): AutomationReviewState & { input: DraftReviewInput } => {
  const raw = {
    id: "review-1",
    status,
    diagnostic: status === "error" ? ("draft-expired" as const) : null,
    input: {
      actor: {
        type: "mcp",
        clientId: "client.test",
        sessionId: "0195b5ac-b250-7a2c-8c33-000000000002",
      },
      commands: [
        {
          commandId: "0195b5ac-b250-7a2c-8c33-000000000003",
          documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
          baseRevision: 2,
          issuedAt: "2026-09-07T00:00:00.000Z",
          actor: {
            type: "mcp",
            clientId: "client.test",
            sessionId: "0195b5ac-b250-7a2c-8c33-000000000002",
          },
          kind: "org.vibeshape.document.rename",
          schemaVersion: 1,
          payload: { name: "Reviewed document" },
        },
      ],
      preview: {
        schemaVersion: 2,
        draft: {
          schemaVersion: 1,
          draftId: "0195b5ac-b250-7a2c-8c33-000000000004",
          documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
          baseRevision: 2,
          revision: 3,
          commandCount: 1,
          expiresAt: "2099-09-07T00:00:00.000Z",
        },
        summary: {
          kind: "org.vibeshape.document.summary",
          schemaVersion: 1,
          documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
          revision: 3,
          classification: "semantic",
          truncated: false,
          data: {
            name: "Reviewed document",
            createdAt: "2026-09-07T00:00:00Z",
            updatedAt: "2026-09-07T00:00:00Z",
          },
        },
        geometry: {
          status: "valid",
          measurements: {
            kind: "org.vibeshape.model.measurements",
            schemaVersion: 1,
            documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
            revision: 3,
            generation: 3,
            classification: "derived",
            nextCursor: null,
            units: { length: "mm", area: "mm2", volume: "mm3" },
            data: { total: 0, features: [] },
          },
        },
      },
    },
  }
  return {
    ...raw,
    input: {
      actor: commandActorSchema.parse(raw.input.actor),
      commands: raw.input.commands.map((command) => documentCommandSchema.parse(command)),
      preview: automationDraftPreviewSchema.parse(raw.input.preview),
    },
  }
}

function renderPanel(state: AutomationReviewState) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AutomationReviewPanel review={state} />
    </I18nProvider>,
  )
}

function textureReview(operation: "create" | "remove" = "create") {
  const { snapshot, layer } = surfaceTextureProjectFixture()
  const actor = commandActorSchema.parse({
    type: "mcp",
    clientId: "client.test",
    sessionId: textureFixtureId(9),
  })
  const input: SurfaceTextureReviewInput = {
    kind: "surface-texture",
    actor,
    operation,
    layerId: layer.id,
    documentName: snapshot.name,
    featureName: "Housing",
    draft: {
      draftId: textureFixtureId(500),
      baseRevision: snapshot.revision,
      draftVersion: 0,
      expiresAt: "2099-01-01T00:00:00Z",
    },
    command: surfaceTextureCommandSchema.parse({
      schemaVersion: 3,
      kind: "org.vibeshape.document.metadata-command",
      commandId: textureFixtureId(501),
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      issuedAt: "2026-10-04T00:00:00Z",
      actor,
      payload: {
        kind: "textures.replace-layers",
        featureId: layer.featureId,
        layers: operation === "create" ? [layer] : [],
      },
    }),
    preview: { bodyCount: 1, sourceTriangleCount: 12, triangleCount: 48, vertexCount: 26 },
  }
  return { id: "texture-review", status: "ready", diagnostic: null, input } as const
}

it("keeps Apply locked until the exact current texture viewport draft is ready", () => {
  const state = textureReview()
  const draft = {
    documentId: state.input.command.documentId,
    revision: state.input.draft.baseRevision,
    featureId: state.input.command.payload.featureId,
    layers: state.input.command.payload.layers,
  }
  const preview = {
    active: true,
    draft,
    readyDraft: { ...draft },
    status: "ready" as const,
    showOriginal: false,
    brush: null,
    setDraft: vi.fn(),
    setReadyDraft: vi.fn(),
    setStatus: vi.fn(),
    setShowOriginal: vi.fn(),
    setBrush: vi.fn(),
  }
  vi.spyOn(texturePreview, "useSurfaceTexturePreviewContext").mockReturnValue(preview)
  renderPanel(state)
  expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
  expect(screen.getByRole("button", { name: "Discard" }).hasAttribute("disabled")).toBe(false)
  cleanup()
  vi.mocked(texturePreview.useSurfaceTexturePreviewContext).mockReturnValue({
    ...preview,
    readyDraft: draft,
    status: "error",
  })
  renderPanel(state)
  expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
  cleanup()
  vi.mocked(texturePreview.useSurfaceTexturePreviewContext).mockReturnValue({
    ...preview,
    readyDraft: draft,
  })
  renderPanel(state)
  expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(false)
})

it("requires destructive confirmation before removing the reviewed texture collection", async () => {
  const decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
  renderPanel(textureReview("remove"))
  await userEvent.click(screen.getByRole("button", { name: "Apply" }))
  expect(screen.getByRole("alertdialog")).toBeTruthy()
  expect(decide).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }))
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide).toHaveBeenCalledWith("texture-review", "approved")
})

describe("AutomationReviewPanel", () => {
  it("locks Apply and Discard while the approved transaction is being saved", () => {
    renderPanel(review("applying"))
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "Apply" }).getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("button", { name: "Discard" }).hasAttribute("disabled")).toBe(true)
  })

  it("requires destructive confirmation for replacing the variable table", async () => {
    const decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
    const state = review()
    const previous = state.input.commands[0]
    const command = documentCommandSchema.parse({
      ...previous,
      kind: "org.vibeshape.variable.replace-table",
      payload: { variables: [] },
    })
    renderPanel({ ...state, input: { ...state.input, commands: [command] } })
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(decide).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(decide).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    await userEvent.click(screen.getByRole("button", { name: "Apply changes" }))
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledWith("review-1", "approved")
  })
  it("renders bounded preview details and approves through the review controller", async () => {
    const decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
    renderPanel(review())
    expect(screen.getByRole("region", { name: "Review AI changes" })).toBeTruthy()
    expect(screen.getByText("Reviewed document", { exact: true })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(decide).toHaveBeenCalledWith("review-1", "approved")
  })

  it("dismisses the persistent error when Close is activated", async () => {
    const dismiss = vi.spyOn(automationReviews, "dismiss").mockImplementation(() => undefined)
    renderPanel(review("error"))
    expect(screen.getByRole("status").textContent).toContain("review expired")
    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(dismiss).toHaveBeenCalledWith("review-1")
  })
})

it("shows the exact folder range and feature-preserving removal in manual review", () => {
  const proposal = review()
  const input = {
    ...proposal.input,
    commands: [],
    metadata: {
      change: documentV2MetadataChangeSchema.parse({
        kind: "folder.remove",
        folderId: "0195b5ac-b250-7a2c-8c33-000000000009",
      }),
      targetName: "Housing operations",
      range: {
        first: historyItemRefSchema.parse({
          kind: "feature",
          id: "0195b5ac-b250-7a2c-8c33-000000000007",
        }),
        last: historyItemRefSchema.parse({
          kind: "feature",
          id: "0195b5ac-b250-7a2c-8c33-000000000008",
        }),
        firstLabel: "Box",
        lastLabel: "Fillet",
        count: 2,
      },
    },
  }
  renderPanel({ ...proposal, input })
  expect(screen.getByText("Remove History folder")).toBeTruthy()
  expect(screen.getByText("Target: Housing operations")).toBeTruthy()
  expect(screen.getByText("Range: Box to Fillet (2 History items)")).toBeTruthy()
  expect(
    screen.getByText("Ungroup these History items. All features and geometry are preserved."),
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: /^Apply$/ })).toBeTruthy()
})

it.each([null, "Base sketch"])(
  "shows the exact History move target and anchor %s",
  async (anchor) => {
    const proposal = review()
    const item = historyItemRefSchema.parse({
      kind: "feature",
      id: "0195b5ac-b250-7a2c-8c33-000000000007",
    })
    const historyAfter = anchor
      ? historyItemRefSchema.parse({ kind: "sketch", id: "0195b5ac-b250-7a2c-8c33-000000000008" })
      : null
    const decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
    renderPanel({
      ...proposal,
      input: {
        ...proposal.input,
        commands: [],
        historyMove: {
          command: moveHistoryItemCommandSchema.parse({
            ...proposal.input.commands[0],
            kind: "org.vibeshape.history.move-item",
            payload: { item, historyAfter },
          }),
          target: documentSnapshotV2Schema.parse({
            schemaVersion: 2,
            id: proposal.input.preview.draft.documentId,
            revision: 3,
            name: "Reviewed document",
            displayUnits: { length: "mm", angle: "deg" },
            createdAt: "2026-09-07T00:00:00Z",
            updatedAt: "2026-09-07T00:00:00Z",
            sketches: [],
            features: [],
            history: [],
            variables: [],
            parts: [],
            folders: [],
          }),
          itemLabel: "Housing extrusion",
          historyAfterLabel: anchor,
        },
      },
    })
    expect(screen.getByText("Move History item")).toBeTruthy()
    expect(screen.getByText("Target: Housing extrusion")).toBeTruthy()
    expect(
      screen.getByText(anchor ? "Place after Base sketch" : "Place at the start of History"),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(decide).toHaveBeenCalledWith("review-1", "rejected")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(decide).toHaveBeenCalledWith("review-1", "approved")
  },
)

it.each(["undo", "redo"] as const)(
  "shows saved and publication revisions and retains manual %s Apply/Discard",
  async (direction) => {
    const source = review()
    const request = historyRequestSchema.parse({
      direction,
      commandId: "0195b5ac-b260-7a2c-8c33-000000000777",
      documentId: source.input.preview.draft.documentId,
      baseRevision: 7,
      issuedAt: "2026-10-04T00:00:00Z",
      actor: source.input.actor,
    })
    const input: HistoryReviewInput = {
      kind: "history",
      actor: request.actor,
      documentName: "Saved model",
      request,
      draft: {
        draftId: draftIdSchema.parse("0195b5ac-b260-7a2c-8c33-000000000778"),
        documentId: request.documentId,
        baseRevision: 7,
        commandId: request.commandId,
        direction,
        targetRevision: 3,
        expiresAt: "2099-01-01T00:00:00Z",
      },
      preview: {
        valid: true,
        measurements: {
          schemaVersion: 1,
          documentId: request.documentId,
          revision: 3,
          generation: 3,
          features: [],
        },
      },
      featureCount: 0,
      partCount: 0,
    }
    const decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
    renderPanel({ ...source, input })
    expect(
      screen.getByText(direction === "undo" ? "Undo saved change" : "Redo saved change"),
    ).toBeTruthy()
    expect(screen.getByText("Saved target revision").nextElementSibling?.textContent).toBe("3")
    expect(screen.getByText("New revision after Apply").nextElementSibling?.textContent).toBe("8")
    expect(screen.getByText("Exact saved-target preview")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(decide).toHaveBeenCalledWith("review-1", "rejected")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(decide).toHaveBeenCalledWith("review-1", "approved")
  },
)
