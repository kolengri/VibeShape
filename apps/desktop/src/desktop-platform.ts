export function desktopArtifactName(version: string, arch: string, platform: NodeJS.Platform) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64"))
    return `VibeShape-${version}-mac-${arch}.dmg`
  if (platform === "win32" && arch === "x64") return `VibeShape-${version}-win-x64.zip`
  throw new Error("The desktop platform or architecture is unsupported.")
}
