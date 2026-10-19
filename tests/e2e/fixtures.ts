import { test as base, expect, type Page } from "@playwright/test"

export async function createEditorProject(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "New project", exact: true }).click()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
}

type RuntimeHealthFixture = {
  runtimeHealth: undefined
  autoCreateProject: boolean
}

export const test = base.extend<RuntimeHealthFixture>({
  autoCreateProject: [true, { option: true }],
  page: async ({ page, autoCreateProject }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (...arguments_) => {
      const response = await goto(...arguments_)
      const url = new URL(page.url())
      if (autoCreateProject && url.pathname === "/" && !url.searchParams.has("project")) {
        await createEditorProject(page)
      }
      return response
    }
    await use(page)
  },
  runtimeHealth: [
    async ({ page }, use) => {
      const runtimeErrors: string[] = []

      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeErrors.push(`console: ${message.text()}`)
        }
      })
      page.on("pageerror", (error) => {
        runtimeErrors.push(`page: ${error.message}`)
      })

      await use(undefined)

      expect(runtimeErrors, "The page must not emit console errors or uncaught exceptions").toEqual(
        [],
      )
    },
    { auto: true },
  ],
})

export { expect }
