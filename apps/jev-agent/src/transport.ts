import type { Fetch } from "@typesafe-ai/sdk"

// SDK 0.7.0 drains response.clone(); a stream wrapper avoids Bun's native buffered-body reuse.
export const typesafeFetch: Fetch = async (url, init) => {
  const response = await fetch(url, { ...init, redirect: "error" })
  const reader = response.body?.getReader()
  if (!reader) return response
  let bytes = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          reader.releaseLock()
          controller.close()
          return
        }
        bytes += chunk.value.byteLength
        if (bytes > 1024 * 1024) throw new Error("The TypeSafe response exceeded 1 MiB.")
        controller.enqueue(chunk.value)
      } catch (error) {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
      reader.releaseLock()
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
