// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import { commandActorSchema, documentCommandSchema } from "@vibeshape/domain/commands"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { automationReviews } from "./automation-review-controller"
import { AutomationReviewPanel } from "./automation-review-panel"
import type { AutomationReviewState } from "./automation-review-state"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const review = (status: "ready" | "error" | "applying" = "ready"): AutomationReviewState => {
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

function renderPanel(state: ReturnType<typeof review>) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AutomationReviewPanel review={state} />
    </I18nProvider>,
  )
}

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
    expect(decide).toHaveBeenCalledExactlyOnceWith("review-1", "approved")
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
