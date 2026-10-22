import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog"
import { TextField } from "./text-field"

afterEach(cleanup)

it("preserves the caller's cancelled autofocus and chosen focus target", async () => {
  render(
    <Dialog defaultOpen>
      <DialogContent
        closeLabel="Close"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          screen.getByRole("button", { name: "Keep focus" }).focus()
        }}
      >
        <DialogTitle>Edit name</DialogTitle>
        <DialogDescription>Choose a name.</DialogDescription>
        <TextField label="Name" description="Use a unique name." />
        <button type="button">Keep focus</button>
      </DialogContent>
    </Dialog>,
  )
  const target = screen.getByRole("button", { name: "Keep focus" })
  await waitFor(() => expect(document.activeElement === target).toBe(true))
})

it("falls back to ordinary dialog focus when the autofocus input is disabled", async () => {
  render(
    <Dialog defaultOpen>
      <DialogContent closeLabel="Close">
        <DialogTitle>Inspect name</DialogTitle>
        <DialogDescription>The name is locked.</DialogDescription>
        <TextField autoFocus disabled label="Name" description="Use a unique name." />
      </DialogContent>
    </Dialog>,
  )
  const input = screen.getByRole("textbox", { name: "Name" })
  const help = screen.getByRole("button", { name: "Help for Name" })
  expect(input.matches(":disabled")).toBe(true)
  await waitFor(() => expect(document.activeElement === help).toBe(true))
})
