import { SectionCapRuntime } from "./section-cap-runtime"

const runtime = new SectionCapRuntime()
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const response = runtime.process(event.data)
  const transfer: ArrayBuffer[] = []
  if (response.type === "sectionCapsComputed")
    for (const cap of response.caps) if (cap) transfer.push(cap.buffer)
  self.postMessage(response, { transfer })
})
