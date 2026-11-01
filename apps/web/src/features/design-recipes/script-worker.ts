import { z } from "zod"
import { executeDesignScript, SCRIPT_SOURCE_LIMIT } from "./script-sandbox"

const requestSchema = z.object({ source: z.string().max(SCRIPT_SOURCE_LIMIT) }).strict()
self.onmessage = async (event: MessageEvent<unknown>) => {
  const request = requestSchema.safeParse(event.data)
  if (!request.success) {
    self.postMessage({ ok: false, message: "The script request is invalid." })
    return
  }
  try {
    self.postMessage({ ok: true, recipe: await executeDesignScript(request.data.source) })
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "Script execution failed.",
    })
  }
}
