import { canonicalJson } from "@vibeshape/domain"
import type { ZodType } from "zod"
import { sha256Text } from "./hash"

export async function serializeStoredRecord(value: unknown) {
  const payload = canonicalJson(value)
  return { payload, checksum: await sha256Text(payload) }
}

export async function parseStoredRecordPayload<Output>(
  record: Readonly<{ payload: string; checksum: string }>,
  schema: ZodType<Output>,
) {
  if ((await sha256Text(record.payload)) !== record.checksum) return null
  try {
    return schema.parse(JSON.parse(record.payload))
  } catch {
    return null
  }
}
