import { existsSync } from "node:fs"

export function testAssetPath(url: string) {
  if (url.startsWith("/@fs/")) return url.slice(4)
  return existsSync(url) ? url : `.${url}`
}
