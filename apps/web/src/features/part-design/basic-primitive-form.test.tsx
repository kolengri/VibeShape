import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  coneFeatureType,
  createLengthQuantity,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  pyramidFeatureType,
  sphereFeatureType,
  torusFeatureType,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n, messages } from "../../i18n"
import {
  BasicPrimitiveForm,
  type BasicPrimitiveFormCopy,
  type BasicPrimitiveKind,
} from "./basic-primitive-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2951")
const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2952")
const variables = [
  { schemaVersion: 0 as const, id: variableId, name: "radius", expression: "12 mm" },
]
const types = {
  sphere: sphereFeatureType.type,
  cone: coneFeatureType.type,
  pyramid: pyramidFeatureType.type,
  torus: torusFeatureType.type,
}

function formCopy(primitiveKind: BasicPrimitiveKind, editing: boolean): BasicPrimitiveFormCopy {
  const catalog = messages.en.app.shell.taskPanel
  const primitive = catalog[primitiveKind]
  return {
    ...catalog.basicPrimitive,
    parameters: primitive.parameters,
    title: editing ? primitive.editTitle : primitive.title,
    description: editing ? primitive.editDescription : primitive.description,
    submit: editing ? primitive.update : primitive.create,
    validationSummary: editing ? primitive.updateValidationSummary : primitive.validationSummary,
    staleRevision: primitive.staleRevision,
    saveFailed: editing ? primitive.updateFailed : primitive.createFailed,
  }
}

function renderPrimitive(
  primitiveKind: BasicPrimitiveKind,
  overrides: Partial<ComponentProps<typeof BasicPrimitiveForm>> = {},
) {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onSaved = vi.fn()
  const onPreviewChange = vi.fn()
  const onCancel = vi.fn()
  const copy = formCopy(primitiveKind, overrides.mode?.kind === "edit")
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <BasicPrimitiveForm
        baseRevision={7}
        copy={copy}
        mode={{ kind: "create", createFeatureId: () => featureId, featureLabel: "Primitive 1" }}
        primitiveKind={primitiveKind}
        variables={variables}
        onSave={onSave}
        onSaved={onSaved}
        onCancel={onCancel}
        onPreviewChange={onPreviewChange}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { copy, onSave, onSaved, onPreviewChange, onCancel }
}

async function setLength(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const field = screen.getByRole("combobox", { name: label })
  await user.clear(field)
  await user.type(field, value)
  return field
}

afterEach(cleanup)

describe("BasicPrimitiveForm", () => {
  it.each(["2", "3.5", "65", ""])(
    "rejects pyramid base sides %s and clears the disposable preview",
    async (value) => {
      const user = userEvent.setup()
      const { copy, onPreviewChange, onSave } = renderPrimitive("pyramid", {
        previewStatus: "idle",
      })
      const sides = screen.getByRole("spinbutton", { name: copy.sides })
      expect((sides as HTMLInputElement).value).toBe("4")
      await user.clear(sides)
      if (value) await user.type(sides, value)
      await user.tab()
      await screen.findByText(copy.invalidSides)
      expect(sides.getAttribute("aria-invalid")).toBe("true")
      await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(null))
      expect(onSave).not.toHaveBeenCalled()
      expect(
        (screen.getByRole("button", { name: copy.submit }) as HTMLButtonElement).disabled,
      ).toBe(true)
    },
  )

  it.each(["sphere", "cone", "torus", "pyramid"] as const)(
    "previews and saves %s expressions and signed coordinates through one feature identity",
    async (primitiveKind) => {
      const user = userEvent.setup()
      const { copy, onSave, onPreviewChange, onSaved } = renderPrimitive(primitiveKind)
      const radiusField = primitiveKind === "torus" ? "majorRadius" : "radius"
      await setLength(user, copy[radiusField], "#radius")
      await setLength(user, copy.originX, "-15")
      await setLength(user, copy.originY, "2 cm")
      await setLength(user, copy.originZ, "5 mm")
      if (primitiveKind === "cone" || primitiveKind === "pyramid")
        await user.click(screen.getByRole("checkbox", { name: copy.centered }))
      else expect(screen.queryByRole("checkbox")).toBeNull()

      const expectedParameters = expect.objectContaining({
        [radiusField]: expect.objectContaining({
          value: 12,
          source: expect.objectContaining({ expression: "#radius" }),
        }),
        origin: {
          x: expect.objectContaining({ value: -15 }),
          y: expect.objectContaining({ value: 20 }),
          z: expect.objectContaining({ value: 5 }),
        },
        ...(primitiveKind === "cone" || primitiveKind === "pyramid" ? { centered: true } : {}),
      })
      await waitFor(() =>
        expect(onPreviewChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: featureId, parameters: expectedParameters }),
        ),
      )
      expect(onSave).not.toHaveBeenCalled()
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onSave).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          id: featureId,
          type: types[primitiveKind],
          parameters: expectedParameters,
        }),
      )
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    },
  )

  it.each(["sphere", "cone", "torus", "pyramid"] as const)(
    "restores %s authored expressions and updates the saved feature",
    async (primitiveKind) => {
      const user = userEvent.setup()
      const dimensions =
        primitiveKind === "torus"
          ? {
              majorRadius: createLengthQuantity(12, "mm", "#radius"),
              minorRadius: createLengthQuantity(3, "mm", "3 mm"),
            }
          : {
              radius: createLengthQuantity(12, "mm", "#radius"),
              ...(primitiveKind === "cone" || primitiveKind === "pyramid"
                ? { height: createLengthQuantity(30, "mm", "30 mm"), centered: true }
                : {}),
            }
      const feature = featureRecordSchema.parse({
        schemaVersion: 0,
        id: featureId,
        type: types[primitiveKind],
        parameters: {
          ...dimensions,
          ...(primitiveKind === "pyramid" ? { sides: 6 } : {}),
          origin: {
            x: createLengthQuantity(12, "mm", "#radius"),
            y: createLengthQuantity(-6),
            z: createLengthQuantity(10),
          },
        },
        dependencies: [],
        references: [],
        suppressed: false,
        label: "Authored primitive",
      })
      const { copy, onSave } = renderPrimitive(primitiveKind, { mode: { kind: "edit", feature } })
      const radiusField = primitiveKind === "torus" ? "majorRadius" : "radius"
      expect(
        (screen.getByRole("combobox", { name: copy[radiusField] }) as HTMLInputElement).value,
      ).toBe("#radius")
      expect((screen.getByRole("combobox", { name: copy.originX }) as HTMLInputElement).value).toBe(
        "#radius",
      )
      if (primitiveKind === "cone" || primitiveKind === "pyramid")
        expect(
          (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
        ).toBe(true)
      if (primitiveKind === "pyramid") {
        const sides = screen.getByRole("spinbutton", { name: copy.sides })
        expect((sides as HTMLInputElement).value).toBe("6")
        await user.clear(sides)
        await user.type(sides, "8")
      }
      await setLength(user, copy.originZ, "18 mm")
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect(onSave).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          ...feature,
          parameters: expect.objectContaining({
            ...dimensions,
            origin: expect.objectContaining({ z: expect.objectContaining({ value: 18 }) }),
          }),
        }),
      )
    },
  )

  it("rejects equal torus radii without previewing or saving and focuses the first error", async () => {
    const user = userEvent.setup()
    const { copy, onSave, onPreviewChange } = renderPrimitive("torus")
    const majorRadius = await setLength(user, copy.majorRadius, "5 mm")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(screen.getAllByText(copy.invalidTorusRadii)).toHaveLength(2)
    expect(document.activeElement).toBe(majorRadius)
    expect((majorRadius as HTMLInputElement).value).toBe("5 mm")
    await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(null))
    expect(onSave).not.toHaveBeenCalled()
  })

  it("explains invalid torus radii while exact preview keeps Apply disabled", async () => {
    const user = userEvent.setup()
    const { copy, onSave, onPreviewChange } = renderPrimitive("torus", { previewStatus: "idle" })
    const majorRadius = await setLength(user, copy.majorRadius, "5 mm")
    await user.tab()
    expect(screen.getAllByText(copy.invalidTorusRadii)).toHaveLength(2)
    expect(majorRadius.getAttribute("aria-invalid")).toBe("true")
    expect((screen.getByRole("button", { name: copy.submit }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(onSave).not.toHaveBeenCalled()
    await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(null))
  })

  it.each(["#missing", "10 deg", "0 mm", "-5 mm"])(
    "preserves and rejects unsupported dimension %s",
    async (expression) => {
      const user = userEvent.setup()
      const { copy, onSave } = renderPrimitive("sphere")
      const radius = await setLength(user, copy.radius, expression)
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect(document.activeElement).toBe(radius)
      expect(radius.getAttribute("aria-invalid")).toBe("true")
      expect((radius as HTMLInputElement).value).toBe(expression)
      expect(onSave).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["sphere", "radius"],
    ["cone", "radius"],
    ["cone", "height"],
    ["torus", "majorRadius"],
    ["torus", "minorRadius"],
  ] as const)(
    "rejects %s %s below the kernel-supported minimum",
    async (primitiveKind, fieldName) => {
      const user = userEvent.setup()
      const { copy, onSave, onPreviewChange } = renderPrimitive(primitiveKind)
      const field = await setLength(user, copy[fieldName], "0.0005 mm")
      expect(await screen.findByText(copy.invalidRange)).toBeTruthy()
      expect(field.getAttribute("aria-invalid")).toBe("true")
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect((field as HTMLInputElement).value).toBe("0.0005 mm")
      expect(onSave).not.toHaveBeenCalled()
      await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(null))
    },
  )

  it("reports coupled workspace bounds instead of accepting individually valid placement", async () => {
    const user = userEvent.setup()
    const { copy, onSave } = renderPrimitive("sphere")
    await setLength(user, copy.originX, "100000 mm")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(screen.getAllByText(copy.invalidWorkspaceBounds)).toHaveLength(4)
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each(["sphere", "cone", "torus", "pyramid"] as const)(
    "applies graphical %s placement without a document write",
    async (primitiveKind) => {
      const { copy, onSave, onPreviewChange } = renderPrimitive(primitiveKind, {
        placementRequest: { featureId, position: [-4, 9.25, 16], sequence: 1 },
      })
      expect((screen.getByRole("combobox", { name: copy.originX }) as HTMLInputElement).value).toBe(
        "-4 mm",
      )
      expect((screen.getByRole("combobox", { name: copy.originY }) as HTMLInputElement).value).toBe(
        "9.25 mm",
      )
      expect((screen.getByRole("combobox", { name: copy.originZ }) as HTMLInputElement).value).toBe(
        "16 mm",
      )
      await waitFor(() =>
        expect(onPreviewChange).toHaveBeenLastCalledWith(
          expect.objectContaining({
            id: featureId,
            parameters: expect.objectContaining({
              origin: {
                x: expect.objectContaining({ value: -4 }),
                y: expect.objectContaining({ value: 9.25 }),
                z: expect.objectContaining({ value: 16 }),
              },
            }),
          }),
        ),
      )
      expect(onSave).not.toHaveBeenCalled()
    },
  )

  it("prevents duplicate apply while saving and releases pending state after a failed save", async () => {
    const user = userEvent.setup()
    let finish: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const onSave = vi.fn(async () => {
      await pending
      return {
        ok: false as const,
        diagnostic: {
          code: "persistence-failed" as const,
          message: "Test save failure",
          retryable: true,
          sourceCode: null,
        },
      }
    })
    const { copy, onSaved } = renderPrimitive("sphere", { onSave })
    const submit = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(submit)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(submit.getAttribute("aria-busy")).toBe("true")
    finish?.()
    await screen.findByText(copy.saveFailed)
    expect(submit.getAttribute("aria-busy")).not.toBe("true")
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it("keeps apply unavailable until exact preview is ready", () => {
    const { copy } = renderPrimitive("torus", { previewStatus: "loading" })
    expect((screen.getByRole("button", { name: copy.submit }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
