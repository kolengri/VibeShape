export async function sha256Bytes(bytes: Uint8Array) {
  const owned = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest("SHA-256", owned)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

export function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}
