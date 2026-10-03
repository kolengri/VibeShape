import type { Locator, Page } from "@playwright/test"

export const resultOperationLabels = {
  new: "New body",
  add: "Add to body",
  remove: "Remove from body",
  intersect: "Intersect with body",
} as const

export async function selectResultOperation(
  page: Page,
  form: Locator,
  operation: keyof typeof resultOperationLabels,
) {
  await form.getByRole("combobox", { name: "Result operation", exact: true }).click()
  await page.getByRole("option", { name: resultOperationLabels[operation], exact: true }).click()
}
