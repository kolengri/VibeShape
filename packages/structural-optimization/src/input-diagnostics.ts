import type { z } from "zod"

export function invalidInputMessage(prefix: string, error: z.ZodError) {
  const issues = error.issues.slice(0, 3).map(({ path, message }) => {
    const location = path.map(String).join(".").slice(0, 80) || "input"
    return `${location}: ${message.slice(0, 160)}`
  })
  // Browser automation forwards this message through its 512-character diagnostic boundary.
  return [prefix, ...issues].join(" ").slice(0, 512)
}
