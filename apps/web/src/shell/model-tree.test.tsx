// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  boxFeatureType,
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { ModelTree } from "./model-tree"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20, "mm", "20 mm"),
    depth: createLengthQuantity(20, "mm", "20 mm"),
    height: createLengthQuantity(20, "mm", "20 mm"),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
})

const controller = {
  status: "ready",
  report: { snapshot: { features: [feature] } },
} as unknown as DocumentControllerState

afterEach(cleanup)

describe("ModelTree", () => {
  it("exposes the active feature and activates it by stable feature identity", async () => {
    const user = userEvent.setup()
    const onFeatureActivate = vi.fn()

    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <ModelTree
          activeFeatureId={featureId}
          activeSketchId={null}
          activeWorkspace="model"
          controller={controller}
          onFeatureActivate={onFeatureActivate}
          onSketchActivate={vi.fn()}
          onWorkspaceChange={vi.fn()}
        />
      </I18nProvider>,
    )

    const featureItem = screen.getByRole("treeitem", { name: "Box 1" })
    expect(featureItem.getAttribute("aria-selected")).toBe("true")
    await user.click(featureItem)
    expect(onFeatureActivate).toHaveBeenCalledWith(featureId)
  })
})
