import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { webcrypto } from "node:crypto"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { assemblyJointSchema } from "@vibeshape/domain/assembly"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { AssemblyDefinitionForm } from "./assembly-definition-form"
import { AssemblyTaskPanelContext } from "./assembly-forms"
import { AssemblyInstanceForm } from "./assembly-instance-form"
import { AssemblyJointForm } from "./assembly-joint-form"
import { assemblyPoseFromEuler, identityAssemblyPose, newAssemblyInstance } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"

function actions() {
  return { pending: false, onApply: vi.fn().mockResolvedValue(true), onCancel: vi.fn() }
}
function setup(ui: React.ReactNode, title: string) {
  function view(form: React.ReactNode, error: string | null = null) {
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <AssemblyTaskPanelContext.Provider value={{ title, error }}>
          {form}
        </AssemblyTaskPanelContext.Provider>
      </I18nProvider>
    )
  }
  const rendered = render(view(ui))
  return {
    ...rendered,
    rerenderForm: (form: React.ReactNode, error: string | null = null) =>
      rendered.rerender(view(form, error)),
  }
}
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  await userEvent.click(screen.getByRole("option", { name: option }))
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe("Assembly forms", () => {
  it("creates a frozen definition and first independent instance through one Apply", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    setup(
      <AssemblyDefinitionForm
        mode="create"
        sources={f.sources}
        selectedPartId={f.sources[1]?.source.partId ?? null}
        actions={a}
      />,
      "Create definition",
    )
    const header = screen.getByRole("heading", { name: "Create definition" }).closest("header")
    expect(header).not.toBeNull()
    expect(screen.getByRole("button", { name: "Apply" }).closest("header")).toBe(header)
    expect(screen.getByRole("button", { name: "Cancel" }).closest("header")).toBe(header)
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1)
    await userEvent.clear(screen.getByLabelText("Name"))
    await userEvent.type(screen.getByLabelText("Name"), "Reusable bracket")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(a.onApply).toHaveBeenCalledTimes(1))
    const changes = a.onApply.mock.calls[0]?.[0]
    expect(changes).toMatchObject([
      {
        kind: "definition.create",
        definition: { name: "Reusable bracket", sources: [f.sources[1]?.source] },
      },
      { kind: "instance.create", instance: { name: "Reusable bracket instance", grounded: true } },
    ])
    expect(changes[0].definition.id).not.toBe(changes[1].instance.id)
  })
  it("preserves the exact authored quaternion on a metadata-only rename, including gimbal lock", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    const definition = {
      ...f.definition,
      sourceFrame: assemblyPoseFromEuler([3, 4, 5], [20, 90, -45]),
    }
    const before = structuredClone(definition)
    setup(
      <AssemblyDefinitionForm
        mode="metadata"
        definition={definition}
        sources={f.sources}
        selectedPartId={null}
        actions={a}
      />,
      "Edit definition",
    )
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } })
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply).toHaveBeenCalledWith([
      {
        kind: "definition.update",
        definitionId: definition.id,
        name: "Renamed",
        sourceFrame: before.sourceFrame,
      },
    ])
    expect(definition).toEqual(before)
  })
  it("keeps pins unchanged until explicit Relink Apply and cancels without a command", async () => {
    const f = assemblyUiFixture(),
      a = actions(),
      before = structuredClone(f.definition)
    setup(
      <AssemblyDefinitionForm
        mode="relink"
        definition={f.definition}
        sources={f.sources}
        selectedPartId={null}
        actions={a}
      />,
      "Relink definition",
    )
    await choose("Source Part", "Part 2")
    expect(f.definition).toEqual(before)
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(a.onCancel).toHaveBeenCalledTimes(1)
    expect(a.onApply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply.mock.calls[0]?.[0]).toMatchObject([
      {
        kind: "definition.relink",
        definition: { id: f.definition.id, sources: [f.sources[1]?.source] },
      },
    ])
    expect(f.definition).toEqual(before)
  })
  it("publishes child creation and its fixed joint atomically with distinct captured identities", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    setup(
      <AssemblyJointForm assembly={f.assembly} selectedId={f.parent.id} actions={a} />,
      "Add joint",
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    const changes = a.onApply.mock.calls[0]?.[0]
    expect(changes).toMatchObject([
      { kind: "instance.create", instance: { grounded: false } },
      { kind: "joint.create", joint: { kind: "fixed", parentInstanceId: f.parent.id } },
    ])
    expect(changes[1].joint.childInstanceId).toBe(changes[0].instance.id)
    expect(changes[0].instance.id).not.toBe(f.parent.id)
    expect(changes[0].instance).not.toHaveProperty("worldFrame")
    expect(changes[1].joint).not.toHaveProperty("value")
  })
  it("rejects an out-of-limit revolute drive and a zero axis while retaining fields for correction", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    const child = newAssemblyInstance(f.definition, "Arm", identityAssemblyPose, () => id(502))
    const joint = assemblyJointSchema.parse({
      schemaVersion: 1,
      id: id(503),
      kind: "revolute",
      parentInstanceId: f.parent.id,
      childInstanceId: child.id,
      parentFrame: identityAssemblyPose,
      childFrame: identityAssemblyPose,
      axis: [0, 0, 1],
      value: 0,
      limits: { min: -Math.PI / 4, max: Math.PI / 4 },
    })
    setup(
      <AssemblyJointForm
        assembly={{ ...f.assembly, instances: [f.parent, child], joints: [joint] }}
        joint={joint}
        selectedId={child.id}
        actions={a}
      />,
      "Edit joint and drive",
    )
    fireEvent.change(screen.getByLabelText("Drive (deg)"), { target: { value: "46" } })
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Drive (deg)"), { target: { value: "45" } })
    fireEvent.change(screen.getByLabelText("Z", { exact: true }), { target: { value: "0" } })
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Z", { exact: true }), { target: { value: "1" } })
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply.mock.calls[0]?.[0]).toMatchObject([
      { kind: "joint.update", joint: { id: joint.id, value: Math.PI / 4 } },
    ])
  })
  it("edits a prismatic drive in millimeters and preserves its explicit axis", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    const child = newAssemblyInstance(f.definition, "Slide", identityAssemblyPose, () => id(502))
    const joint = assemblyJointSchema.parse({
      schemaVersion: 1,
      id: id(503),
      kind: "prismatic",
      parentInstanceId: f.parent.id,
      childInstanceId: child.id,
      parentFrame: identityAssemblyPose,
      childFrame: identityAssemblyPose,
      axis: [1, 0, 0],
      value: 2,
      limits: { min: -5, max: 10 },
    })
    setup(
      <AssemblyJointForm
        assembly={{ ...f.assembly, instances: [f.parent, child], joints: [joint] }}
        joint={joint}
        selectedId={child.id}
        actions={a}
      />,
      "Edit joint and drive",
    )
    fireEvent.change(screen.getByLabelText("Drive (mm)"), { target: { value: "10" } })
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply.mock.calls[0]?.[0]).toMatchObject([
      { kind: "joint.update", joint: { value: 10, axis: [1, 0, 0], limits: { min: -5, max: 10 } } },
    ])
  })
  it("places independent instances from XYZ fields and uses Escape to cancel a pending form", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    setup(<AssemblyInstanceForm assembly={f.assembly} actions={a} />, "Add instance")
    fireEvent.change(screen.getByLabelText("X (mm)"), { target: { value: "30" } })
    fireEvent.change(screen.getByLabelText("Z (deg)"), { target: { value: "90" } })
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" })
    expect(a.onCancel).toHaveBeenCalledTimes(1)
    expect(a.onApply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(a.onApply.mock.calls[0]?.[0]).toMatchObject([
      {
        kind: "instance.create",
        instance: { grounded: true, worldFrame: { translation: [30, 0, 0] } },
      },
    ])
    const quaternion = a.onApply.mock.calls[0]?.[0]?.[0].instance.worldFrame.quaternion
    expect(quaternion[2]).toBeCloseTo(Math.SQRT1_2, 14)
    expect(quaternion[3]).toBeCloseTo(Math.SQRT1_2, 14)
  })

  it("closes definition search before Escape cancels the assembly task", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    setup(<AssemblyInstanceForm assembly={f.assembly} actions={a} />, "Add instance")
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved bracket" } })
    fireEvent.change(screen.getByLabelText("X (mm)"), { target: { value: "30" } })
    const trigger = screen.getByRole("combobox", { name: "Definition" })
    await userEvent.click(trigger)
    await userEvent.type(screen.getByRole("combobox", { name: "Search options…" }), "missing")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    expect(a.onCancel).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Unsaved bracket")
    expect((screen.getByLabelText("X (mm)") as HTMLInputElement).value).toBe("30")
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await userEvent.keyboard("{Escape}")
    expect(a.onCancel).toHaveBeenCalledTimes(1)
    expect(a.onApply).not.toHaveBeenCalled()
  })

  it("locks header actions during apply and preserves edited instance fields after failure", async () => {
    const f = assemblyUiFixture(),
      a = actions()
    a.onApply.mockResolvedValue(false)
    const form = (pending: boolean) => (
      <AssemblyInstanceForm assembly={f.assembly} instance={f.parent} actions={{ ...a, pending }} />
    )
    const { rerenderForm } = setup(form(false), "Edit instance")
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited base" } })
    rerenderForm(form(true))
    const apply = screen.getByRole<HTMLButtonElement>("button", { name: "Apply" })
    const cancel = screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
    expect(apply.disabled).toBe(true)
    expect(apply.getAttribute("aria-busy")).toBe("true")
    expect(cancel.disabled).toBe(true)
    expect(
      (screen.getByLabelText("Name").closest("fieldset") as HTMLFieldSetElement).disabled,
    ).toBe(true)
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" })
    const nativeForm = apply.closest("form")
    if (!nativeForm) throw new Error("Assembly lifecycle actions must belong to their form.")
    fireEvent.submit(nativeForm)
    await userEvent.click(cancel)
    expect(a.onApply).not.toHaveBeenCalled()
    expect(a.onCancel).not.toHaveBeenCalled()

    rerenderForm(form(false), "Apply failed")
    await userEvent.click(apply)
    await waitFor(() => expect(a.onApply).toHaveBeenCalledTimes(1))
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Edited base")
    expect(a.onCancel).not.toHaveBeenCalled()
    expect(cancel.disabled).toBe(false)
    expect(apply.getAttribute("aria-busy")).not.toBe("true")
    expect(screen.getByRole("alert").textContent).toBe("Apply failed")
    expect(screen.getAllByRole("heading")).toHaveLength(1)
    const header = screen.getByRole("heading", { name: "Edit instance" }).closest("header")
    expect(header).not.toBeNull()
    expect(apply.closest("header")).toBe(header)
    expect(cancel.closest("header")).toBe(header)
    expect(screen.getByRole("alert").closest("header")).toBeNull()
  })
})
