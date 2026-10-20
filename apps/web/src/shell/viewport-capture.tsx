import { createContext, type ReactNode, useContext, useState } from "react"

type Capture = () => Promise<Blob | null>

export function createViewportCapturePort() {
  const captures = new Set<Capture>()
  return {
    register(capture: Capture) {
      captures.add(capture)
      return () => {
        captures.delete(capture)
      }
    },
    async capture() {
      for (const capture of [...captures].reverse()) {
        const image = await capture()
        if (!captures.has(capture)) return null
        if (image) return image
      }
      return null
    },
  }
}

const ViewportCaptureContext = createContext<ReturnType<typeof createViewportCapturePort> | null>(
  null,
)

export function ViewportCaptureProvider({ children }: { children: ReactNode }) {
  const [port] = useState(createViewportCapturePort)
  return <ViewportCaptureContext value={port}>{children}</ViewportCaptureContext>
}

export function useViewportCapture() {
  return useContext(ViewportCaptureContext)
}
