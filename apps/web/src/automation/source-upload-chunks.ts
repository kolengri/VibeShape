import { IMPORT_UPLOAD_CHUNK_MAX_BYTES } from "@vibeshape/automation-api/imports"
import { localFailure } from "@vibeshape/automation-api/local-tools"

/** Append to private owned bytes; identical retries never renew the upload lease. */
export function appendOwnedSourceChunk(
  owned: Uint8Array,
  receivedBytes: number,
  captured: boolean,
  input: { offset: number; base64: string },
) {
  const { offset, base64 } = input
  const binary = atob(base64)
  if (
    btoa(binary) !== base64 ||
    binary.length !== Math.min(IMPORT_UPLOAD_CHUNK_MAX_BYTES, owned.length - offset)
  )
    return localFailure(
      "invalid-import-chunk",
      "Import chunks must use canonical base64 and the declared chunk size.",
    )
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (offset < receivedBytes)
    return offset + bytes.length <= receivedBytes &&
      bytes.every((byte, index) => owned[offset + index] === byte)
      ? { ok: true as const, receivedBytes }
      : localFailure("import-chunk-conflict", "The repeated import chunk differs from owned bytes.")
  if (captured || offset !== receivedBytes)
    return localFailure(
      "import-chunk-order",
      "Append at the current receivedBytes offset before inspection.",
    )
  owned.set(bytes, offset)
  return { ok: true as const, receivedBytes: offset + bytes.length }
}
