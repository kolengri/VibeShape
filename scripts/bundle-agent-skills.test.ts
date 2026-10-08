import { expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { agentSkillBundlePath, renderAgentSkillBundle } from "./bundle-agent-skills"

it("keeps all bundled instructions synchronized and usable in a relocated Bun server bundle", () => {
  expect(readFileSync(agentSkillBundlePath, "utf8")).toBe(renderAgentSkillBundle())
  const directory = mkdtempSync(join(tmpdir(), "vibeshape-bundled-skills-"))
  try {
    const module = resolve(import.meta.dirname, "../packages/automation-api/src/agent-skills.ts")
    const entrypoint = join(directory, "entry.ts")
    writeFileSync(
      entrypoint,
      `import { readAgentSkillResource } from ${JSON.stringify(module)}; console.log(JSON.stringify(readAgentSkillResource("vibeshape://agent-skills")));`,
    )
    const build = spawnSync(
      "bun",
      ["build", entrypoint, "--target=bun", "--outdir", join(directory, "relocated")],
      { encoding: "utf8" },
    )
    expect(build.status, build.stdout + build.stderr).toBe(0)
    const run = spawnSync("bun", [join(directory, "relocated/entry.js")], {
      cwd: directory,
      encoding: "utf8",
    })
    expect(run.status, run.stdout + run.stderr).toBe(0)
    const content = JSON.parse(run.stdout).contents[0]
    expect(content.mimeType).toBe("application/json")
    const index = JSON.parse(content.text)
    expect(index.skills).toHaveLength(5)
    expect(index.entrypoint).toBe("vibeshape://agent-skills/vibeshape-use/SKILL.md")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
