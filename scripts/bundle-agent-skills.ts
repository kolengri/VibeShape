import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const skillNames = [
  "vibeshape-use",
  "vibeshape-modeling",
  "vibeshape-inspection",
  "vibeshape-organization",
  "vibeshape-export",
] as const
const resourceRoot = "vibeshape://agent-skills"
export const agentSkillBundlePath = join(
  root,
  "packages/automation-api/src/generated/agent-skills.json",
)

function markdownFiles(directory: string, prefix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}/${entry.name}`
    if (entry.isDirectory()) return markdownFiles(join(directory, entry.name), relative)
    return entry.isFile() && entry.name.endsWith(".md") ? [relative] : []
  })
}

function metadata(source: string, name: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)?.[1]
  if (!header || !new RegExp(`^name: ${name}$`, "m").test(header))
    throw new Error(`Invalid skill metadata: ${name}`)
  const description = /^description: (.+)$/m.exec(header)?.[1]
  if (!description) throw new Error(`Missing skill description: ${name}`)
  return description
}

function resourceLinks(source: string, path: string, paths: Set<string>): string {
  return source.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (original, label: string, target: string) => {
    if (target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return original
    const [file = "", ...fragment] = target.split("#")
    const destination = posix.normalize(posix.join(posix.dirname(path), file))
    if (!paths.has(destination)) throw new Error(`Unbundled skill link in ${path}: ${target}`)
    const suffix = fragment.length ? `#${fragment.join("#")}` : ""
    return `[${label}](${resourceRoot}/${destination}${suffix})`
  })
}

export function renderAgentSkillBundle(): string {
  const directory = join(root, ".agents/skills")
  const paths = skillNames.flatMap((name) => markdownFiles(join(directory, name), name)).sort()
  const available = new Set(paths)
  const documents = paths.map((path) => {
    const text = resourceLinks(readFileSync(join(directory, path), "utf8"), path, available)
    if (Buffer.byteLength(text, "utf8") > 64 * 1024)
      throw new Error(`Skill resource exceeds 64 KiB: ${path}`)
    return { path, text }
  })
  const skills = skillNames.map((name) => ({
    name,
    description: metadata(readFileSync(join(directory, name, "SKILL.md"), "utf8"), name),
    uri: `${resourceRoot}/${name}/SKILL.md`,
    references: paths
      .filter((path) => path.startsWith(`${name}/references/`))
      .map((path) => ({ path, uri: `${resourceRoot}/${path}` })),
  }))
  return `${JSON.stringify({ schemaVersion: 1, skills, documents }, null, 2)}\n`
}

if (import.meta.main) {
  mkdirSync(dirname(agentSkillBundlePath), { recursive: true })
  writeFileSync(agentSkillBundlePath, renderAgentSkillBundle())
  console.log("Bundled VibeShape operator skills for both MCP transports.")
}
