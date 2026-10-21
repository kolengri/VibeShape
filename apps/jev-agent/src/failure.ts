import { z } from "zod"

const httpFailure = z.object({ status: z.number().int().min(400).max(599) })

// Provider messages can contain credentials, request bodies or response headers.
export class JevFailure extends Error {}

export async function jevOperation<T>(
  context: string,
  operation: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof JevFailure) throw error
    const http = httpFailure.safeParse(error)
    const detail = http.success ? ` (HTTP ${http.data.status})` : ""
    throw new JevFailure(`${context}${detail}.`, { cause: error })
  }
}
