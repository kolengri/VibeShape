// Mirrors Cloudflare's ordered attach/detach semantics for the checked-in static path rules.
function parseHeaderRule(block: string) {
  const [pattern, ...lines] = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
  return pattern ? { pattern, lines } : null
}

function matchesHeaderPath(pattern: string, path: string) {
  const [prefix = "", suffix = ""] = pattern.split("*")
  return pattern.includes("*") ? path.startsWith(prefix) && path.endsWith(suffix) : path === pattern
}

function applyHeaderLine(headers: Headers, applied: Set<string>, line: string) {
  if (line.startsWith("! ")) {
    headers.delete(line.slice(2))
    return
  }
  const colon = line.indexOf(":")
  if (colon < 0) throw new Error("Invalid static header fixture")
  const key = line.slice(0, colon).toLowerCase()
  const value = line.slice(colon + 1).trim()
  if (applied.has(key)) headers.append(key, value)
  else headers.set(key, value)
  applied.add(key)
}

export function cloudflareResponseHeaders(
  config: string,
  path: string,
  initial: Record<string, string> = {},
) {
  const headers = new Headers(initial)
  const applied = new Set<string>()
  for (const block of config.split(/\n\s*\n/)) {
    const rule = parseHeaderRule(block)
    if (!rule || !matchesHeaderPath(rule.pattern, path)) continue
    for (const line of rule.lines) applyHeaderLine(headers, applied, line)
  }
  return Object.fromEntries(headers)
}
