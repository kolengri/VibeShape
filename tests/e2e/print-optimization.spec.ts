import { writeFile } from "node:fs/promises"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

for (const theme of ["light", "dark"] as const) {
  test(`opens automatic FDM optimization and retains accessible controls in ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto("/")
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), theme === "dark")
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box", exact: true })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
    await invokeModelCommand(page, "Modify", "Lightweighting")
    const panel = page.getByRole("region", { name: "Optimize for 3D printing", exact: true })
    await expect(panel).toBeVisible()
    await panel.getByRole("combobox", { name: "Source Part", exact: true }).click()
    await page.getByRole("option", { name: "Box 1", exact: true }).click()
    await panel.getByRole("combobox", { name: "Material preset", exact: true }).click()
    await expect(page.getByRole("option", { name: /Aluminum|Stainless/ })).toHaveCount(0)
    await page.getByRole("option", { name: "PLA — Prusament", exact: true }).click()
    const bed = panel.getByRole("button", { name: "Choose print-bed face", exact: true })
    await bed.click()
    await expect(bed).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("Escape")
    await expect(panel).toBeVisible()
    await expect(bed).toHaveAttribute("aria-pressed", "false")
    await panel.getByRole("button", { name: "Preserve faces (0)", exact: true }).click()
    await page.keyboard.press("Escape")
    await panel.getByText("Advanced optimization settings", { exact: true }).click()
    await expect(panel.getByLabel("Minimum retained stiffness (%)", { exact: true })).toHaveValue(
      "90",
    )
    await expect(
      panel.getByLabel("Minimum retained normalized load capacity (%)", { exact: true }),
    ).toHaveValue("90")
    await panel.getByText("Advanced optimization settings", { exact: true }).click()
    await page.screenshot({ path: `artifacts/topology-print-optimization/panel-${theme}.png` })
    await page.locator("html").evaluate((element) => {
      element.style.zoom = "2"
    })
    await panel
      .getByRole("button", { name: "Optimize for printing", exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      panel.getByRole("button", { name: "Optimize for printing", exact: true }),
    ).toBeVisible()
    await panel
      .getByRole("button", { name: "Set real supports and loads manually", exact: true })
      .click()
    await expect(page.getByRole("region", { name: "Lightweighting", exact: true })).toBeVisible()
  })
}

test("preserves a selected face through exact reconstruction, real FEM reanalysis and atomic Apply/Undo", async ({
  page,
}) => {
  test.setTimeout(240_000)
  page.setDefaultTimeout(10_000)
  await page.addInitScript(() => {
    const NativeWorker = Reflect.get(globalThis, "Worker")
    const messages: unknown[] = []
    Reflect.set(globalThis, "printWorkerMessages", messages)
    Reflect.set(
      globalThis,
      "Worker",
      class extends NativeWorker {
        constructor(url: string | URL, options?: ConstructorParameters<typeof NativeWorker>[1]) {
          super(url, options)
          this.addEventListener("message", ({ data }: { data: unknown }) => messages.push(data))
        }
      },
    )
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  for (const [label, value] of [
    ["Width", "16 mm"],
    ["Depth", "8 mm"],
    ["Height", "8 mm"],
  ] as const)
    await form.getByRole("combobox", { name: label, exact: true }).fill(value)
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
  await invokeModelCommand(page, "Modify", "Lightweighting")
  const panel = page.getByRole("region", { name: "Optimize for 3D printing", exact: true })
  await panel.getByRole("combobox", { name: "Source Part", exact: true }).click()
  await page.getByRole("option", { name: "Box 1", exact: true }).click()
  await panel.getByRole("combobox", { name: "Material preset", exact: true }).click()
  await page.getByRole("option", { name: "PLA — Prusament", exact: true }).click()
  const canvas = page.getByRole("region", { name: "3D viewport", exact: true }).locator("canvas")
  await panel.getByRole("button", { name: "Choose print-bed face", exact: true }).click()
  const viewport = await canvas.boundingBox()
  if (!viewport) throw new Error("The source viewport is unavailable.")
  const pick = { x: viewport.width * 0.5, y: viewport.height * 0.42 }
  await canvas.click({ position: pick })
  await expect(
    panel.getByRole("button", { name: "Change print-bed face", exact: true }),
  ).toBeVisible()
  await panel.getByRole("button", { name: "Preserve faces (0)", exact: true }).click()
  await canvas.click({ position: { x: viewport.width * 0.49, y: viewport.height * 0.5 } })
  await panel.getByRole("button", { name: "Finish preserving faces (1)", exact: true }).click()
  await panel.getByText("Advanced optimization settings", { exact: true }).click()
  const iterations = panel.getByLabel("Density and reconstruction search iterations", {
    exact: true,
  })
  await iterations.fill("0")
  await panel.getByRole("button", { name: "Optimize for printing", exact: true }).click()
  await expect(
    panel.getByText("No feasible material reduction was found. Apply is unavailable.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 180_000 })
  await expect(panel.getByRole("alert")).toHaveCount(0)
  await expect(
    panel.getByRole("button", { name: "Apply as new exact Part", exact: true }),
  ).toBeDisabled()
  await iterations.fill("24")
  await panel.getByText("Advanced optimization settings", { exact: true }).click()
  await panel.getByRole("button", { name: "Optimize for printing", exact: true }).click()
  const completed = panel.getByText(
    "A lighter exact CAD solid passed reconstructed-body analysis.",
    {
      exact: true,
    },
  )
  await expect(completed.or(panel.getByRole("alert")).first()).toBeVisible({ timeout: 180_000 })
  await writeFile(
    "artifacts/topology-print-optimization/exact-browser-worker-messages.json",
    JSON.stringify(await page.evaluate(() => Reflect.get(globalThis, "printWorkerMessages"))),
  )
  await expect(completed).toBeVisible()
  await expect(
    panel.getByText("1 original CAD face retained unchanged.", { exact: true }),
  ).toBeVisible()
  const apply = panel.getByRole("button", { name: "Apply as new exact Part", exact: true })
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await page.screenshot({ path: "artifacts/topology-print-optimization/exact-preview.png" })
  await apply.click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: /^Part / })).toHaveCount(2)
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: /^Part / })).toHaveCount(1)
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: /^Part / })).toHaveCount(2)
})
