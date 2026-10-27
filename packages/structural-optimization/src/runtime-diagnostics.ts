import { z } from "zod"
import { invalidInputMessage } from "./input-diagnostics"

export type NumericalRuntimeStage =
  | "request validation"
  | "module loading"
  | "runtime initialization"
  | "package loading"
  | "solver loading"
  | "source preparation"
  | "solve"
  | "geometry generation"
  | "geometry validation"
  | "response validation"

const errorMessageSchema = z.union([
  z.string(),
  z
    .instanceof(Error)
    .transform((error) => error.message)
    .pipe(z.string()),
])

function exceptionMessage(message: string) {
  if (!message.includes("Traceback (most recent call last):"))
    return message.split(/\r?\n/, 1)[0] ?? ""
  const lines = message
    .slice(-4_096)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
  return lines.find((line) => /^[\w.]*(?:Error|Exception)(?::|$)/.test(line)) ?? lines[0] ?? ""
}

function safeRuntimeUrls(message: string) {
  return message
    .replace(/\b(?:data|blob):\S+/gi, "[runtime URL omitted]")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (value) => {
      try {
        const url = new URL(value)
        url.username = ""
        url.password = ""
        url.search = ""
        url.hash = ""
        return url.href
      } catch {
        return "[invalid runtime URL]"
      }
    })
}

/** Worker failures cross the same 512-character diagnostic boundary as browser automation. */
export function numericalRuntimeMessage(stage: NumericalRuntimeStage, error: unknown) {
  const prefix = `The numerical runtime failed during ${stage}:`
  if (error instanceof z.ZodError)
    return safeRuntimeUrls(invalidInputMessage(prefix, error)).slice(0, 512)
  const parsed = errorMessageSchema.safeParse(error)
  const detail = parsed.success ? exceptionMessage(parsed.data).trim() : ""
  const cause = detail ? safeRuntimeUrls(detail).replace(/\s+/g, " ") : "Unknown runtime error."
  return `${prefix} ${cause}`.slice(0, 512)
}
