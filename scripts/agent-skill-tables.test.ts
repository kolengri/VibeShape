import { expect, it } from "bun:test"
import { join } from "node:path"
import { markdownTableViolations, validateAgentSkillTables } from "./agent-skill-tables"

it("reports a paragraph glued onto the last table row", () => {
  const source = [
    "| Code | Retry |",
    "|---|---|",
    "| `drawing-failed` | Kernel flag | Optional `settings` accepts:",
    "",
    "```md",
    "| inside a fence | is ignored",
    "```",
  ].join("\n")
  expect(markdownTableViolations(source, "doc.md")).toEqual([
    'doc.md:3: table row must end with "|" (add a blank line after the table)',
  ])
})

it("keeps every operator and developer skill table well formed", () => {
  expect(validateAgentSkillTables(join(import.meta.dir, ".."))).toEqual([])
})
