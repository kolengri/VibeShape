import { zipSync } from "fflate"
import { motionArchiveRequestSchema } from "./assembly-motion-archive-contract"

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  try {
    const request = motionArchiveRequestSchema.parse(event.data)
    const archive = zipSync(request.files)
    globalThis.postMessage({ ok: true, archive }, { transfer: [archive.buffer] })
  } catch {
    globalThis.postMessage({ ok: false })
  }
})
