import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { readUiPluginPackage, type UiPluginResult } from "./ui-plugin-package"
import { sampleUiPlugin } from "./ui-plugin-sample"

function accepted<T>(result: UiPluginResult<T>) {
  if (!result.ok) throw new Error(result.error)
  return result.value
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe("declarative UI plugin packages", () => {
  it("validates a useful calculator and pins the original UTF-8 bytes", async () => {
    const original = bytes(sampleUiPlugin)
    const pkg = accepted(await readUiPluginPackage(original))
    expect(pkg.integrity).toBe(createHash("sha256").update(original).digest("hex"))
    expect(pkg.source).toBe(new TextDecoder().decode(original))
    expect(pkg.manifest.commands[0]?.panelId).toBe("fit")
    const changed = accepted(await readUiPluginPackage(new TextEncoder().encode(`${pkg.source}\n`)))
    expect(changed.integrity).not.toBe(pkg.integrity)
  })

  it("rejects unsupported executable payloads and authority before installation", async () => {
    const variants = [
      { ...sampleUiPlugin, script: "alert(1)" },
      { ...sampleUiPlugin, html: "<script>parent.localStorage.clear()</script>" },
      { ...sampleUiPlugin, capabilities: ["ui.panel", "model.command"] },
      { ...sampleUiPlugin, profile: "workspace-javascript" },
      { ...sampleUiPlugin, schemaVersion: 2 },
      { ...sampleUiPlugin, commands: [{ id: "read-model", label: "Read", panelId: "missing" }] },
    ]
    for (const variant of variants)
      expect(await readUiPluginPackage(bytes(variant))).toEqual({
        ok: false,
        error: "invalid-package",
      })
  })

  it("rejects duplicate IDs, invalid numeric bounds, and unresolved formula inputs", async () => {
    const panel = sampleUiPlugin.panels[0]
    if (!panel) throw new Error("Missing sample panel")
    const field = panel.inputs[0]
    if (!field) throw new Error("Missing sample field")
    for (const invalid of [
      { ...panel, inputs: [field, field] },
      { ...panel, inputs: [{ ...field, default: 10001 }] },
      { ...panel, inputs: [{ ...field, step: 0 }] },
      {
        ...panel,
        outputs: [
          {
            id: "result",
            label: "Result",
            unit: "mm",
            constant: 0,
            terms: [{ inputId: "missing", coefficient: 1 }],
          },
        ],
      },
    ])
      expect(await readUiPluginPackage(bytes({ ...sampleUiPlugin, panels: [invalid] }))).toEqual({
        ok: false,
        error: "invalid-package",
      })
  })

  it("rejects malformed, oversized, non-UTF-8, and prototype-bearing packages", async () => {
    expect(await readUiPluginPackage(new Uint8Array(65537))).toEqual({
      ok: false,
      error: "package-too-large",
    })
    expect(await readUiPluginPackage(new Uint8Array([255]))).toEqual({
      ok: false,
      error: "invalid-utf8",
    })
    expect(await readUiPluginPackage(new TextEncoder().encode("{"))).toEqual({
      ok: false,
      error: "invalid-package",
    })
    const source = JSON.stringify(sampleUiPlugin).replace("{", '{"__proto__":{"polluted":true},')
    expect(await readUiPluginPackage(new TextEncoder().encode(source))).toEqual({
      ok: false,
      error: "invalid-package",
    })
    expect(Object.prototype).not.toHaveProperty("polluted")
  })
})
