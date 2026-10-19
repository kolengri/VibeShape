import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { AssemblyAsBuiltJointForm, AssemblyRigidGroupForm } from "./assembly-as-built-form"
import { asBuiltUiFixture } from "./assembly-as-built-test-fixture"
import { type AssemblyFormActions, AssemblyTaskPanelContext } from "./assembly-forms"

afterEach(cleanup)
function setup(group: boolean, version: 1 | 2 = 1) {
  const f = asBuiltUiFixture(version)
  const apply = vi.fn().mockResolvedValue(true)
  const actions: AssemblyFormActions = { pending: false, onApply: apply, onCancel: vi.fn() }
  const Form = group ? AssemblyRigidGroupForm : AssemblyAsBuiltJointForm
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssemblyTaskPanelContext.Provider
        value={{ title: group ? "Rigid group" : "As-built joint", error: null }}
      >
        <Form assembly={f.assembly} capture={f.capture} selectedId={id(510)} actions={actions} />
      </AssemblyTaskPanelContext.Provider>
    </I18nProvider>,
  )
  return { ...f, apply, actions }
}
describe("captured assembly authoring forms", () => {
  it("offers supported kinds and creates one pose-preserving existing-instance joint on Apply", async () => {
    const f = setup(false, 2)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole("combobox", { name: "Child instance" }), id(512))
    await user.selectOptions(screen.getByRole("combobox", { name: "Joint type" }), "cylindrical")
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.apply.mock.calls[0]?.[0]).toMatchObject([
      { kind: "instance.update", instance: { id: id(512), grounded: false, schemaVersion: 2 } },
      {
        kind: "joint.create",
        joint: {
          parentInstanceId: id(510),
          childInstanceId: id(512),
          kind: "cylindrical",
          angle: 0,
          translation: 0,
        },
      },
    ])
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Create instance" })).toBeNull()
  })
  it("keeps old files on their supported joint kinds and cancels without preparing changes", async () => {
    const f = setup(false)
    expect(screen.queryByRole("option", { name: "Cylindrical" })).toBeNull()
    expect(screen.queryByRole("option", { name: "Ball" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.actions.onCancel).toHaveBeenCalledTimes(1)
    expect(f.apply).not.toHaveBeenCalled()
  })
  it("keeps member checks independent and applies one named-anchor star batch", async () => {
    const f = setup(true)
    const user = userEvent.setup()
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("checkbox", { name: "Member 1" }) as HTMLInputElement).disabled).toBe(
      true,
    )
    await user.click(screen.getByRole("checkbox", { name: "Member 2" }))
    await user.click(screen.getByRole("checkbox", { name: "Member 3" }))
    await user.click(screen.getByRole("checkbox", { name: "Member 2" }))
    expect((screen.getByRole("checkbox", { name: "Member 3" }) as HTMLInputElement).checked).toBe(
      true,
    )
    await user.selectOptions(screen.getByRole("combobox", { name: "Anchor instance" }), id(512))
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.apply.mock.calls[0]?.[0]).toMatchObject([
      { kind: "instance.update", instance: { id: id(510), grounded: false } },
      {
        kind: "joint.create",
        joint: { parentInstanceId: id(512), childInstanceId: id(510), kind: "fixed" },
      },
    ])
  })
})
