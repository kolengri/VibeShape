import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Markdown table rows must end with a pipe. A paragraph written directly after a table, without a
 * blank line, becomes an extra cell that GitHub and most renderers silently drop.
 */
export function markdownTableViolations(source: string, label: string): string[] {
  let fenced = false
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const row = line.trim()
    if (fenced || !row.startsWith("|") || row.endsWith("|")) return []
    return [`${label}:${index + 1}: table row must end with "|" (add a blank line after the table)`]
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
