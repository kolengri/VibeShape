// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type VariableDefinition, variableIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { describe, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { evaluateSketchTransformForm, SketchTransformForm } from "./sketch-transform-form"

const variables: readonly VariableDefinition[] = [
  {
    schemaVersion: 0,
    id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3291"),
    name: "spacing",
    expression: "12 mm",
  },
]

describe("SketchTransformForm", () => {
  it("evaluates variable-aware length, angle, and scalar values", () => {
    expect(
      evaluateSketchTransformForm(
        {
          originX: "#spacing / 2",
          originY: "0",
          rotation: "30",
          scale: "1.5",
          translationX: "#spacing",
          translationY: "-2",
        },
        variables,
        { angle: "deg", length: "mm" },
      ),
    ).toEqual({
      origin: { x: 6, y: 0 },
      preview: {
        rotationRadians: Math.PI / 6,
        scale: 1.5,
        translation: { x: 12, y: -2 },
      },
    })
  })

  it("rejects dimensional scales and non-positive scalar scales", () => {
    const base = {
      originX: "0 mm",
      originY: "0 mm",
      rotation: "0 deg",
      translationX: "0 mm",
      translationY: "0 mm",
    }
    expect(
      evaluateSketchTransformForm({ ...base, scale: "2 mm" }, variables, {
        angle: "deg",
        length: "mm",
      }),
    ).toBeNull()
    expect(
      evaluateSketchTransformForm({ ...base, scale: "0" }, variables, {
        angle: "deg",
        length: "mm",
      }),
    ).toBeNull()
  })

  it("submits exact values through the TanStack Form adapter", async () => {
    const onApply = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ angle: "deg", length: "mm" }}>
          <TooltipProvider delayDuration={0}>
            <SketchTransformForm
              value={{
                origin: { x: 0, y: 0 },
                preview: {
                  rotationRadians: 0,
                  scale: 1,
                  translation: { x: 0, y: 0 },
                },
              }}
              variables={variables}
              onApply={onApply}
              onCancel={vi.fn()}
            />
          </TooltipProvider>
        </DocumentDisplayUnitsProvider>
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole("combobox", { name: "Translation X" }), {
      target: { value: "#spacing" },
    })
    fireEvent.change(screen.getByRole("combobox", { name: "Rotation" }), {
      target: { value: "45 deg" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply transform" }))

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith({
        origin: { x: 0, y: 0 },
        preview: {
          rotationRadians: Math.PI / 4,
          scale: 1,
          translation: { x: 12, y: 0 },
        },
      }),
    )
  })
})
