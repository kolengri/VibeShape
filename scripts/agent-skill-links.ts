import { existsSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL, URL } from "node:url"
import GithubSlugger from "github-slugger"
import { JSDOM } from "jsdom"

function markdownReferences(path: string) {
  const source = readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
  const links = new Set<string>()
  const anchors = new Set<string>()
  const dom = new JSDOM(Bun.markdown.html(source))
  try {
    const document = dom.window.document
    for (const element of document.querySelectorAll("a[href], img[src]")) {
      const href = element.getAttribute("href") ?? element.getAttribute("src")
      if (href !== null) links.add(href)
    }
    for (const element of document.querySelectorAll("[id], a[name]")) {
      const id = element.getAttribute("id") ?? element.getAttribute("name")
      if (id !== null) anchors.add(id)
    }
    const slugger = new GithubSlugger()
    for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      anchors.add(slugger.slug(heading.textContent ?? ""))
  } finally {
    dom.window.close()
  }
  return { links, anchors }
}

function localLinkViolation(
  href: string,
  source: string,
  repositoryRoot: string,
  read: (path: string) => ReturnType<typeof markdownReferences>,
): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(href)) return
  try {
    const base = href.startsWith("/") ? join(repositoryRoot, "index.md") : source
    const url = new URL(href.replace(/^\//u, ""), pathToFileURL(base))
    const target = fileURLToPath(url)
    if (!existsSync(target)) return `missing local link target: ${href}`
    const anchor = decodeURIComponent(url.hash.slice(1))
    if (anchor && extname(target).toLowerCase() === ".md" && !read(target).anchors.has(anchor))
      return `missing anchor ${anchor} in ${relative(repositoryRoot, target)}`
  } catch (error) {
    return `invalid local link ${href}: ${String(error)}`
  }
}

export function validateAgentSkillLinks(repositoryRoot: string): string[] {
  const violations: string[] = []
  const documents = new Map<string, ReturnType<typeof markdownReferences>>()
  function read(path: string) {
    const document = documents.get(path) ?? markdownReferences(path)
    documents.set(path, document)
    return document
  }
  for (const file of new Bun.Glob(".agents/skills/**/*.md").scanSync(repositoryRoot)) {
    const path = join(repositoryRoot, file)
    for (const href of read(path).links) {
      const violation = localLinkViolation(href, path, repositoryRoot, read)
      if (violation) violations.push(`${file}: ${violation}`)
    }
  }
  return violations
}
