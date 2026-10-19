import "../../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { assemblyInstanceSchema, assemblyJointSchema } from "@vibeshape/domain/assembly"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"
import { AssemblyTree } from "./assembly-tree"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

function setup(motionDisabled = false) {
  const f = assemblyUiFixture()
  const child = assemblyInstanceSchema.parse({
    schemaVersion: 1,
    id: id(502),
    definitionId: f.definition.id,
    name: "Arm",
    grounded: false,
  })
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
    limits: { min: -1, max: 1 },
  })
  const handlers = {
    onSelectInstance: vi.fn(),
    onSelectDefinition: vi.fn(),
    onSelectJoint: vi.fn(),
    onDriveJoint: vi.fn(),
  }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider delayDuration={0}>
        <AssemblyTree
          {...handlers}
          assembly={{ ...f.assembly, instances: [f.parent, child], joints: [joint] }}
          selectedId={child.id}
          selectedDefinitionId={null}
          motionDisabled={motionDisabled}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  return { ...f, child, joint, ...handlers }
}

describe("Assembly browser", () => {
  it("exposes joint endpoints and independent edit and drive actions", async () => {
    const f = setup()
    const user = userEvent.setup()
    const instance = screen.getByRole("button", { name: /Arm\s*Attached by joint/ })
    const definition = screen.getByRole("button", { name: /Bracket\s*Source pin revision 1/ })
    for (const row of [instance, definition]) {
      expect(row.getAttribute("title")).toBeNull()
      expect(row.querySelector("[title]")).toBeNull()
    }
    await user.hover(instance)
    expect(screen.queryByRole("tooltip")).toBeNull()
    await user.unhover(instance)
    const drive = screen.getByRole("button", { name: "Drive Base → Arm" })
    await user.hover(drive)
    expect((await screen.findByRole("tooltip")).textContent).toBe("Drive Base → Arm")
    await user.unhover(drive)
    await user.click(screen.getByRole("button", { name: "Revolute: Base → Arm" }))
    expect(f.onSelectJoint).toHaveBeenCalledWith(f.joint.id)
    await user.click(screen.getByRole("button", { name: "Drive Base → Arm" }))
    expect(f.onDriveJoint).toHaveBeenCalledWith(f.joint.id)
    expect(
      screen.getByRole("button", { name: /Arm\s*Attached by joint/ }).getAttribute("aria-pressed"),
    ).toBe("true")
    await user.click(screen.getByRole("button", { name: /Bracket\s*Source pin revision 1/ }))
    expect(f.onSelectDefinition).toHaveBeenCalledWith(f.definition.id)
    expect(screen.getByText("2 instances")).not.toBeNull()
  })

  it("filters names and shared definitions and keeps section disclosure independent from selection", async () => {
    const f = setup()
    const user = userEvent.setup()
    const search = screen.getByRole("searchbox", { name: "Filter components and joints" })
    await user.type(search, "Arm")
    expect(screen.queryByRole("button", { name: /Base\s*Grounded/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Arm\s*Attached by joint/ })).not.toBeNull()
    expect(screen.getByRole("button", { name: "Drive Base → Arm" })).not.toBeNull()
    await user.clear(search)
    await user.type(search, "bracket")
    expect(screen.getByRole("button", { name: /Base\s*Grounded/ })).not.toBeNull()
    expect(screen.getByRole("button", { name: /Arm\s*Attached by joint/ })).not.toBeNull()
    await user.click(screen.getByRole("button", { name: "Instances" }))
    expect(screen.queryByRole("button", { name: /Arm\s*Attached by joint/ })).toBeNull()
    expect(f.onSelectInstance).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Instances" }))
    await user.click(screen.getByRole("button", { name: /Arm\s*Attached by joint/ }))
    expect(f.onSelectInstance).toHaveBeenCalledWith(f.child.id)
  })

  it("locks mutation entry points while preserving component inspection", async () => {
    const f = setup(true)
    const user = userEvent.setup()
    const drive = screen.getByRole("button", { name: "Drive Base → Arm" }) as HTMLButtonElement
    const edit = screen.getByRole("button", { name: "Revolute: Base → Arm" }) as HTMLButtonElement
    expect(drive.disabled).toBe(true)
    expect(edit.disabled).toBe(true)
    await user.click(drive)
    await user.click(edit)
    expect(f.onDriveJoint).not.toHaveBeenCalled()
    expect(f.onSelectJoint).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: /Base\s*Grounded/ }))
    expect(f.onSelectInstance).toHaveBeenCalledWith(f.parent.id)
  })
})
