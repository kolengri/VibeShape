import { afterEach, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { validateAgentSkillLinks } from "./agent-skill-links"

const roots: string[] = []

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "vibeshape-skill-links-"))
  roots.push(root)
  for (const [file, source] of Object.entries(files)) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it("validates developer and operator references without treating code examples as links", () => {
  const root = fixture({
    ".agents/skills/developer/SKILL.md": `# Developer
[guide][reference]
[operator](../operator/SKILL.md#operate)
[root](/docs/Guide%20notes.md#details)
[external](https://example.com/missing#anchor)
[resource](vibeshape://agent-skills/index)

[reference]: ../../../docs/Guide%20notes.md#details "Guide"

\`[inline example](missing.md)\`
\`\`\`md
[fenced example](missing.md)
\`\`\`
`,
    ".agents/skills/operator/SKILL.md": "# Operate\n[section](#operate)",
    ".agents/skills/developer/references/nested.md":
      "[details](../../../../docs/Guide%20notes.md#details-1)",
    "docs/Guide notes.md": "# **Details**\n\n# Details\n",
  })
  expect(validateAgentSkillLinks(root)).toEqual([])
})

it("reports missing files in skill entrypoints and nested references", () => {
  const root = fixture({
    ".agents/skills/developer/SKILL.md": "[guide](references/missing.md)",
    ".agents/skills/developer/references/nested.md": "![asset](missing.svg)",
  })
  expect(validateAgentSkillLinks(root).sort()).toEqual([
    ".agents/skills/developer/SKILL.md: missing local link target: references/missing.md",
    ".agents/skills/developer/references/nested.md: missing local link target: missing.svg",
  ])
})

it("rejects traversal to existing files outside the repository, including encoded paths", () => {
  const root = fixture({})
  const sibling = `${root}-sibling`
  roots.push(sibling)
  mkdirSync(sibling)
  writeFileSync(join(sibling, "outside.md"), "# Outside")
  const href = `../../../../${basename(sibling)}/outside.md#outside`
  const encoded = href.replaceAll("..", "%2e%2e")
  const source = join(root, ".agents/skills/developer/SKILL.md")
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, `[plain](${href})\n[encoded](${encoded})`)
  expect(validateAgentSkillLinks(root)).toEqual([
    `.agents/skills/developer/SKILL.md: local link escapes repository root: ${href}`,
    `.agents/skills/developer/SKILL.md: local link escapes repository root: ${encoded}`,
  ])
})

it("rejects links through external symlinks while allowing repository-local symlinks", () => {
  const outside = fixture({ "outside.md": "# Outside" })
  const root = fixture({
    ".agents/skills/developer/SKILL.md":
      "[outside](/external/outside.md#outside)\n[inside](/alias/inside.md#inside)",
    "docs/inside.md": "# Inside",
  })
  symlinkSync(outside, join(root, "external"), "dir")
  symlinkSync(join(root, "docs"), join(root, "alias"), "dir")
  expect(validateAgentSkillLinks(root)).toEqual([
    ".agents/skills/developer/SKILL.md: local link escapes repository root: /external/outside.md#outside",
  ])
})

it("checks local and cross-file anchors and excludes headings inside code fences", () => {
  const root = fixture({
    ".agents/skills/developer/SKILL.md":
      "# Present\n[local](#missing)\n[guide](../../../docs/guide.md#example)",
    "docs/guide.md": "# Actual\n\n```md\n# Example\n```",
  })
  expect(validateAgentSkillLinks(root)).toEqual([
    ".agents/skills/developer/SKILL.md: missing anchor missing in .agents/skills/developer/SKILL.md",
    ".agents/skills/developer/SKILL.md: missing anchor example in docs/guide.md",
  ])
})

it("supports explicit HTML IDs and rejects malformed local URL encoding", () => {
  const root = fixture({
    ".agents/skills/developer/SKILL.md":
      '<a id="custom"></a>\n\n[custom](#custom)\n[bad](bad%ZZ.md)',
  })
  const errors = validateAgentSkillLinks(root)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain("bad%ZZ.md")
})

it("uses GitHub heading anchors for punctuation, underscores, HTML, and suffix collisions", () => {
  const root = fixture({
    ".agents/skills/developer/SKILL.md": `# A &amp; B
# foo_bar
# Details
# Details
# Details-1
# <em>Inline</em> & **formatted** \`x_y\`

[punctuation](#a--b)
[underscore](#foo_bar)
[collision](#details-1-1)
[formatting](#inline--formatted-x_y)
[wrong punctuation](#a-b)
[wrong underscore](#foobar)
[wrong collision](#details-2)
`,
  })
  expect(validateAgentSkillLinks(root)).toEqual([
    ".agents/skills/developer/SKILL.md: missing anchor a-b in .agents/skills/developer/SKILL.md",
    ".agents/skills/developer/SKILL.md: missing anchor foobar in .agents/skills/developer/SKILL.md",
    ".agents/skills/developer/SKILL.md: missing anchor details-2 in .agents/skills/developer/SKILL.md",
  ])
})
