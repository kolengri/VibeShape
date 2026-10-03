import { expect, test } from "@playwright/test"
import { createConsentPage } from "../../apps/remote-mcp/src/consent-page"

const origin = "https://mcp.example"

for (const activation of ["double click", "repeated Enter", "repeated submit"] as const) {
  test(`sends one tab approval for ${activation} and permits retry after returning from failure`, async ({
    page,
  }) => {
    const submissions: URLSearchParams[] = []
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`${origin}/authorize**`, async (route) => {
      if (route.request().method() === "GET") {
        // Worker tests cover real OAuth; this fixture serves the production HTML and CSP.
        const response = createConsentPage(
          { clientName: "Test client", redirectHost: "client.example", redirectIsLoopback: false },
          "test-handle",
        )
        await route.fulfill({
          contentType: "text/html",
          headers: { "Content-Security-Policy": response.policy },
          body: response.html,
        })
        return
      }
      submissions.push(new URLSearchParams(route.request().postData() ?? ""))
      await pending
      await route.fulfill({
        status: 403,
        contentType: "text/html",
        body: "<!doctype html><html><body><h1>Tab approval denied</h1></body></html>",
      })
    })

    try {
      await page.goto(`${origin}/authorize?client_id=test-client`)
      const code = page.getByRole("textbox", { name: "Pairing code" })
      const button = page.getByRole("button", { name: "Request tab approval", exact: true })
      await code.fill("invalid")
      await button.click()
      await expect(button).toBeEnabled()
      expect(submissions).toHaveLength(0)

      await code.fill("0123456789ABCDEF")
      const states: { disabled: boolean; busy: string; status: string }[] = []
      await page.exposeFunction("recordApproval", (state: (typeof states)[number]) => {
        states.push(state)
      })
      // Capture pending DOM state inside submit, before Chromium suspends the navigating frame.
      await page.evaluate(`document.querySelector("form").addEventListener("submit", () => {
        const button = document.querySelector("button");
        window.recordApproval({
          disabled: button.disabled,
          busy: button.getAttribute("aria-busy"),
          status: document.getElementById("approval-status").textContent,
        });
      });`)
      if (activation === "double click") {
        await button.dblclick()
      } else if (activation === "repeated Enter") {
        await page.keyboard.press("Enter")
        await page.keyboard.press("Enter")
      } else {
        await page.locator("form").evaluate((form: { requestSubmit(): void }) => {
          form.requestSubmit()
          form.requestSubmit()
        })
      }
      await expect.poll(() => states.length).toBeGreaterThan(0)
      expect(states[0]).toEqual({
        disabled: true,
        busy: "true",
        status: "Requesting tab approval… Check your VibeShape tab.",
      })
      await expect.poll(() => submissions.length).toBe(1)
      expect(submissions[0]?.get("handle")).toBe("test-handle")
      expect(submissions[0]?.get("pairingCode")).toBe("0123456789ABCDEF")

      release()
      await expect(page.getByRole("heading", { name: "Tab approval denied" })).toBeVisible()
      await page.goBack()
      await expect(button).toBeEnabled()
      await expect(button).not.toHaveAttribute("aria-busy")
      await expect(page.getByRole("status")).toBeEmpty()
      await code.fill("0123456789ABCDEF")
      await button.click()
      await expect(page.getByRole("heading", { name: "Tab approval denied" })).toBeVisible()
      expect(submissions).toHaveLength(2)
    } finally {
      release()
    }
  })
}
