// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type VariableDefinition, variableIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { describe, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import {
  evaluateLinearSketchPatternForm,
  SketchLinearPatternForm,
} from "./sketch-linear-pattern-form"

const variables: readonly VariableDefinition[] = [
  {
    schemaVersion: 0,
    id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3391"),
    name: "spacing",
    expression: "12 mm",
  },
]

describe("SketchLinearPatternForm", () => {
  it("evaluates two variable-aware directions and enforces the total count bound", () => {
    expect(
      evaluateLinearSketchPatternForm(
        {
          firstAngle: "0",
          firstCount: "3",
          firstSpacing: "#spacing",
          secondAngle: "90",
          secondCount: "2",
          secondDirection: true,
          secondSpacing: "5",
        },
        variables,
        { angle: "deg", length: "mm" },
      ),
    ).toEqual({
      first: { angleRadians: 0, count: 3, spacing: 12 },
      second: { angleRadians: Math.PI / 2, count: 2, spacing: 5 },
    })
    expect(
      evaluateLinearSketchPatternForm(
        {
          firstAngle: "0 deg",
          firstCount: "11",
          firstSpacing: "10 mm",
          secondAngle: "90 deg",
          secondCount: "10",
          secondDirection: true,
          secondSpacing: "10 mm",
        },
        variables,
        { angle: "deg", length: "mm" },
      ),
    ).toBeNull()
  })

  it("publishes valid previews and submits through TanStack Form", async () => {
    const onApply = vi.fn()
    const onPreview = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ angle: "deg", length: "mm" }}>
          <TooltipProvider delayDuration={0}>
            <SketchLinearPatternForm
              variables={variables}
              onApply={onApply}
              onCancel={vi.fn()}
              onPreview={onPreview}
            />
          </TooltipProvider>
        </DocumentDisplayUnitsProvider>
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole("combobox", { name: "First spacing" }), {
      target: { value: "#spacing" },
    })
    expect(onPreview).toHaveBeenLastCalledWith({
      first: { angleRadians: 0, count: 3, spacing: 12 },
      second: null,
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply linear pattern" }))
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith({
        first: { angleRadians: 0, count: 3, spacing: 12 },
        second: null,
      }),
    )
  })
})
