import { f3dPreparationSchema, MAX_F3D_BYTES } from "@vibeshape/formats/f3d"
import { z } from "zod"

const response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: f3dPreparationSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string().max(4096) }).strict(),
])
export function prepareF3dSource(
  bytes: Uint8Array,
  createWorker = () =>
    new Worker(new URL("./f3d-parser-worker.ts", import.meta.url), { type: "module" }),
) {
  if (bytes.byteLength > MAX_F3D_BYTES)
    return Promise.reject(new Error("F3D source exceeds its 64 MiB budget."))
  return new Promise<z.infer<typeof f3dPreparationSchema>>((resolve, reject) => {
    const worker = createWorker()
    const cleanup = () => {
      clearTimeout(timeout)
      worker.terminate()
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("F3D preparation timed out."))
    }, 30000)
    worker.onmessage = (event: MessageEvent<unknown>) => {
      cleanup()
      const parsed = response.safeParse(event.data)
      if (!parsed.success) reject(new Error("The F3D worker returned an invalid contract."))
      else if (!parsed.data.ok) reject(new Error(parsed.data.message))
      else resolve(parsed.data.value)
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error("The F3D reader could not run."))
    }
    try {
      const owned = Uint8Array.from(bytes)
      worker.postMessage(owned, [owned.buffer])
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
