import { test as base, expect } from "@playwright/test"

type RuntimeHealthFixture = {
  runtimeHealth: undefined
}

export const test = base.extend<RuntimeHealthFixture>({
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
