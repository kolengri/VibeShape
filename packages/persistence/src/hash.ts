export async function sha256Bytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value))
}
