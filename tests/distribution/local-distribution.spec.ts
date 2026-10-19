import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { openApplicationMenuItem } from "../e2e/application-menu-support"
import { expect, test } from "../e2e/fixtures"
import { invokeModelCommand } from "../e2e/model-command-support"

const distribution = resolve(process.env.VIBESHAPE_DISTRIBUTION_ROOT ?? "")

test("the relocated package preserves saved work across stop, restart, backup recovery and MCP", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const cwd = await mkdtemp(join(tmpdir(), "vibeshape-distribution-cwd-"))
  const executable = join(distribution, "vibeshape")
  const port = 44820 + testInfo.parallelIndex
  const origin = `http://127.0.0.1:${port}`
  let editor: ChildProcessWithoutNullStreams | undefined
  const startEditor = async () => {
    const child = spawn(executable, ["editor", "--port", String(port)], { cwd })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8192)
    })
    child.stdin.end()
    editor = child
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`Editor exited: ${stderr}`)
          return fetch(origin)
            .then((response) => response.status)
            .catch(() => 0)
        },
        { timeout: 20_000 },
      )
      .toBe(200)
  }
  const stopEditor = async () => {
    if (!editor) return
    editor.kill("SIGINT")
    await expect.poll(() => editor?.exitCode, { timeout: 10_000 }).toBe(0)
    editor = undefined
  }
  let local: Awaited<ReturnType<typeof createMcpTestClient>> | undefined
  try {
    await startEditor()
    await page.goto(origin)
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await expect(page.getByRole("button", { name: /Enable AI session|Stop AI/ })).toHaveCount(0)
    expect(await fetch(`${origin}/__vibeshape/automation/status`).then((r) => r.status)).toBe(404)
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box" })
    for (const [name, value] of [
      ["Width", "22 mm"],
      ["Depth", "30 mm"],
      ["Height", "40 mm"],
    ] as const)
      await form.getByRole("combobox", { name, exact: true }).fill(value)
    await form.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )

    const conflicting = spawn(executable, ["editor", "--port", String(port)], { cwd })
    let conflictMessage = ""
    conflicting.stderr.on("data", (chunk) => {
      conflictMessage += String(chunk)
    })
    conflicting.stdin.end()
    await expect.poll(() => conflicting.exitCode, { timeout: 15_000 }).toBe(1)
    expect(conflictMessage).toContain("never takes over a running session")
    expect(await fetch(origin).then((r) => r.status)).toBe(200)

    await stopEditor()
    await startEditor()
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    const edit = page.getByRole("form", { name: "Edit box" })
    await expect(edit.getByRole("combobox", { name: "Width", exact: true })).toHaveValue("22 mm")
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    const downloadReady = page.waitForEvent("download")
    await openApplicationMenuItem(page, "Save project (.vshape)")
    const download = await downloadReady
    const backup = testInfo.outputPath("saved-model.vshape")
    await download.saveAs(backup)
    const bytes = await readFile(backup)
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    const recovery = await browser.newContext()
    const recovered = await recovery.newPage()
    const recoveryErrors: string[] = []
    recovered.on("pageerror", (error) => recoveryErrors.push(error.message))
    recovered.on("console", (message) => {
      if (message.type() === "error") recoveryErrors.push(message.text())
    })
    try {
      await recovered.goto(origin)
      await recovered.getByLabel("Choose VibeShape project file").setInputFiles(backup)
      await expect(recovered.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
      await expect(recovered.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
        "data-rendered-feature-count",
        "1",
      )
      await recovered.getByRole("treeitem", { name: "Box 1", exact: true }).click()
      await expect(
        recovered
          .getByRole("form", { name: "Edit box" })
          .getByRole("combobox", { name: "Width", exact: true }),
      ).toHaveValue("22 mm")
      expect(recoveryErrors).toEqual([])
    } finally {
      await recovery.close()
    }

    await stopEditor()
    local = await createMcpTestClient(port, { command: executable, args: ["mcp"], cwd })
    const tools = (await local.client.listTools()).tools
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length)
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "read_agent_skill",
        "model_parts",
        "model_folders",
        "model_history",
        "change_metadata",
      ]),
    )
    await page.reload()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
    const result = await local.callTool({ name: "model_info", arguments: {} })
    const model = localToolOutputs.model_info.parse(result.structuredContent?.result)
    if (!model.ok) throw new Error(model.diagnostic.message)
    const bodies = model.value.measurements?.data.features
    expect(bodies).toHaveLength(1)
    const body = bodies?.[0]
    if (body?.status !== "succeeded") throw new Error("The recovered model did not rebuild.")
    expect(body.shape.volume).toBeCloseTo(26400, 6)
    expect(body.shape.solidCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath("recovered-packaged-model.png") })
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    await expect(page.getByRole("button", { name: "Enable AI session", exact: true })).toBeVisible()
    await page.goto("about:blank")
    await local.close()
    local = undefined
    await startEditor()
    await stopEditor()
  } finally {
    await local?.close()
    if (editor && editor.exitCode === null) await stopEditor()
    await rm(cwd, { recursive: true, force: true })
  }
})
