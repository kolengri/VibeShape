// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type VariableDefinition, variableIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { describe, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import {
  evaluateCircularSketchPatternForm,
  SketchCircularPatternForm,
} from "./sketch-circular-pattern-form"

const variables: readonly VariableDefinition[] = [
  {
    schemaVersion: 0,
    id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3392"),
    name: "radius",
    expression: "12 mm",
  },
]

describe("SketchCircularPatternForm", () => {
  it("evaluates variable-aware centers and validates open sweep bounds", () => {
    expect(
      evaluateCircularSketchPatternForm(
        { angle: "180", centerX: "#radius", centerY: "5", closed: false, count: "4" },
        variables,
        { angle: "deg", length: "mm" },
      ),
    ).toEqual({
      angleRadians: Math.PI,
      center: { x: 12, y: 5 },
      closed: false,
      count: 4,
    })
    expect(
      evaluateCircularSketchPatternForm(
        { angle: "360 deg", centerX: "0", centerY: "0", closed: false, count: "3" },
        variables,
        { angle: "deg", length: "mm" },
      ),
    ).toBeNull()
  })

  it("publishes closed previews and submits through TanStack Form", async () => {
    const onApply = vi.fn()
    const onPreview = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ angle: "deg", length: "mm" }}>
          <TooltipProvider delayDuration={0}>
            <SketchCircularPatternForm
              variables={variables}
              onApply={onApply}
              onCancel={vi.fn()}
              onPreview={onPreview}
            />
          </TooltipProvider>
        </DocumentDisplayUnitsProvider>
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole("combobox", { name: "Center X" }), {
      target: { value: "#radius" },
    })
    expect(onPreview).toHaveBeenLastCalledWith({
      angleRadians: Math.PI * 2,
      center: { x: 12, y: 0 },
      closed: true,
      count: 3,
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply circular pattern" }))
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith({
        angleRadians: Math.PI * 2,
        center: { x: 12, y: 0 },
        closed: true,
        count: 3,
      }),
    )
  })
})
