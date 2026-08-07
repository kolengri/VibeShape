import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const repositoryRoot = join(import.meta.dir, "..")
const skillsDirectory = join(repositoryRoot, ".agents", "skills")
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const violations: string[] = []

function report(message: string): void {
  violations.push(message)
}

function normalizedYamlFieldValue(rawValue: string): string | undefined {
  const lines = rawValue.split(/\r?\n/)
  const [firstLine = ""] = lines
  const contentLines = /^[>|][-+]?$/.test(firstLine.trim()) ? lines.slice(1) : lines
  const value = contentLines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  return value === "" ? undefined : value
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*(?:\\r?\\n[ \\t]+.*)*)`, "mu"))
  return match ? normalizedYamlFieldValue(String(match[1])) : undefined
}

function quotedMetadataValue(metadata: string, key: string): string | undefined {
  return metadata.match(new RegExp(`^  ${key}: "([^"]*)"$`, "mu"))?.[1]
}

function validateSkillName(skillName: string, relativeDirectory: string): void {
  if (!skillNamePattern.test(skillName) || skillName.length >= 64) {
    report(`${relativeDirectory}: folder name must be kebab-case and shorter than 64 characters`)
  }
}

function readSkillSource(skillFile: string, relativeDirectory: string): string | undefined {
  if (existsSync(skillFile)) return readFileSync(skillFile, "utf8")
  report(`${relativeDirectory}: missing SKILL.md`)
  return undefined
}

function readFrontmatter(skillSource: string, relativeDirectory: string): string | undefined {
  const frontmatter = skillSource.match(frontmatterPattern)?.[1]
  if (frontmatter) return frontmatter
  report(`${relativeDirectory}/SKILL.md: missing valid YAML frontmatter`)
  return undefined
}

function validateFrontmatter(
  frontmatter: string,
  skillName: string,
  relativeDirectory: string,
): void {
  const keys = [...frontmatter.matchAll(/^([a-z][a-z0-9_-]*):/gmu)].map((match) => match[1])
  const unexpectedKeys = keys.filter((key) => key !== "name" && key !== "description")
  if (unexpectedKeys.length > 0) {
    report(`${relativeDirectory}/SKILL.md: unexpected keys: ${unexpectedKeys.join(", ")}`)
  }
  if (frontmatterValue(frontmatter, "name") !== skillName) {
    report(`${relativeDirectory}/SKILL.md: name must match the folder`)
  }
  if (!frontmatterValue(frontmatter, "description")) {
    report(`${relativeDirectory}/SKILL.md: description is required`)
  }
}

function validateMetadata(
  metadataFile: string,
  skillName: string,
  relativeDirectory: string,
): void {
  if (!existsSync(metadataFile)) {
    report(`${relativeDirectory}/agents/openai.yaml: missing UI metadata`)
    return
  }

  const metadata = readFileSync(metadataFile, "utf8")
  validateDisplayName(metadata, relativeDirectory)
  validateShortDescription(metadata, relativeDirectory)
  validateDefaultPrompt(metadata, skillName, relativeDirectory)
}

function validateDisplayName(metadata: string, relativeDirectory: string): void {
  if (!quotedMetadataValue(metadata, "display_name")) {
    report(`${relativeDirectory}/agents/openai.yaml: display_name is required`)
  }
}

function validateShortDescription(metadata: string, relativeDirectory: string): void {
  const shortDescription = quotedMetadataValue(metadata, "short_description")
  if (!shortDescription || shortDescription.length < 25 || shortDescription.length > 64) {
    report(`${relativeDirectory}/agents/openai.yaml: short_description must be 25-64 characters`)
  }
}

function validateDefaultPrompt(
  metadata: string,
  skillName: string,
  relativeDirectory: string,
): void {
  const defaultPrompt = quotedMetadataValue(metadata, "default_prompt")
  if (!defaultPrompt?.includes(`$${skillName}`)) {
    report(`${relativeDirectory}/agents/openai.yaml: default_prompt must mention $${skillName}`)
  }
}

function validateSkillDocument(
  skillSource: string,
  skillName: string,
  relativeDirectory: string,
): void {
  const frontmatter = readFrontmatter(skillSource, relativeDirectory)
  if (frontmatter) validateFrontmatter(frontmatter, skillName, relativeDirectory)
  if (skillSource.includes("[TODO") || skillSource.includes("TODO:")) {
    report(`${relativeDirectory}/SKILL.md: unresolved TODO placeholder`)
  }
}

function validateSkill(skillName: string): void {
  const relativeDirectory = `.agents/skills/${skillName}`
  const skillDirectory = join(skillsDirectory, skillName)
  const skillSource = readSkillSource(join(skillDirectory, "SKILL.md"), relativeDirectory)
  validateSkillName(skillName, relativeDirectory)
  if (skillSource) validateSkillDocument(skillSource, skillName, relativeDirectory)
  validateMetadata(join(skillDirectory, "agents", "openai.yaml"), skillName, relativeDirectory)
}

if (!existsSync(skillsDirectory)) {
  report(".agents/skills: directory is missing")
} else {
  const skillNames = readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const skillName of skillNames) validateSkill(skillName)
}

if (violations.length > 0) {
  console.error("Agent skill validation failed:\n")
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log("Agent skill validation passed.")
