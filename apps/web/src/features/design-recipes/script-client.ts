import { designRecipeSchema } from "@vibeshape/application/design-recipes"
import { z } from "zod"

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), recipe: designRecipeSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string().max(512) }).strict(),
])

export function runDesignScript(source: string, signal?: AbortSignal) {
  return new Promise<z.infer<typeof designRecipeSchema>>((resolve, reject) => {
    const worker = new Worker(new URL("./script-worker.ts", import.meta.url), { type: "module" })
    let settled = false
    const finish = (error?: Error, recipe?: z.infer<typeof designRecipeSchema>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      worker.terminate()
      if (error) reject(error)
      else if (recipe) resolve(recipe)
    }
    const cancel = () => finish(new Error("Script execution cancelled."))
    const timer = setTimeout(
      () => finish(new Error("Script loading or execution exceeded 20 seconds.")),
      20_000,
    )
    signal?.addEventListener("abort", cancel, { once: true })
    worker.onerror = () => finish(new Error("The isolated script worker could not run."))
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const result = responseSchema.safeParse(event.data)
      if (!result.success) finish(new Error("The script worker returned an invalid result."))
      else if (!result.data.ok) finish(new Error(result.data.message))
      else finish(undefined, result.data.recipe)
    }
    if (signal?.aborted) cancel()
    else worker.postMessage({ source })
  })
}
