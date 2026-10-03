// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { assemblyJointSchema } from "@vibeshape/domain/assembly"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { AssemblyDefinitionForm } from "./assembly-definition-form"
import { AssemblyInstanceForm } from "./assembly-instance-form"
import { AssemblyJointForm } from "./assembly-joint-form"
import { assemblyPoseFromEuler, identityAssemblyPose, newAssemblyInstance } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"

function actions() {
  return { pending: false, onApply: vi.fn().mockResolvedValue(true), onCancel: vi.fn() }
}
function setup(ui: React.ReactNode) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      {ui}
    </I18nProvider>,
  )
}
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  await userEvent.click(screen.getByRole("option", { name: option }))
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
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
    )
    await userEvent.clear(screen.getByLabelText("Name"))
    await userEvent.type(screen.getByLabelText("Name"), "Reusable bracket")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(a.onApply).toHaveBeenCalledOnce())
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
    )
    await choose("Source Part", "Part 2")
    expect(f.definition).toEqual(before)
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(a.onCancel).toHaveBeenCalledOnce()
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
    setup(<AssemblyJointForm assembly={f.assembly} selectedId={f.parent.id} actions={a} />)
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
    setup(<AssemblyInstanceForm assembly={f.assembly} actions={a} />)
    fireEvent.change(screen.getByLabelText("X (mm)"), { target: { value: "30" } })
    fireEvent.change(screen.getByLabelText("Z (deg)"), { target: { value: "90" } })
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" })
    expect(a.onCancel).toHaveBeenCalledOnce()
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
})
