import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Markdown table rows must end with a pipe, and the line after a table must be blank or another
 * row. A paragraph written directly after a table, without a blank line, becomes an extra cell or
 * an extra row that GitHub and most renderers render as table content or silently drop.
 */
export function markdownTableViolations(source: string, label: string): string[] {
  let fenced = false
  let afterRow = false
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const row = line.trim()
    const previousRow = afterRow
    afterRow = !fenced && row.startsWith("|")
    if (fenced) return []
    const at = `${label}:${index + 1}`
    if (afterRow && !row.endsWith("|"))
      return [`${at}: table row must end with "|" (add a blank line after the table)`]
    if (previousRow && !afterRow && row !== "")
      return [
        `${at}: text directly after a table row joins the table (add a blank line after the table)`,
      ]
    return []
  })
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith(".md") ? [path] : []
  })
}

export function validateAgentSkillTables(repositoryRoot: string): string[] {
  return markdownFiles(join(repositoryRoot, ".agents", "skills"))
    .sort()
    .flatMap((path) =>
      markdownTableViolations(readFileSync(path, "utf8"), relative(repositoryRoot, path)),
    )
}
