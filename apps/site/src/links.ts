export const repository = "https://github.com/kolengri/VibeShape"
export const editorUrl = "https://cad.hello-world.cz"
export const releasesUrl = `${repository}/releases`
export const desktopDownloadUrl = `${repository}/releases/download/desktop-v0.1.4/VibeShape-0.1.4-mac-arm64.dmg`
export const referenceUrl = (path: string) => `${repository}/blob/main/${path}`

export const articles = [
  { id: "getting-started", reference: "docs/product/ux-flows.md", icon: "start" },
  { id: "local-installation", reference: "docs/local-distribution.md", icon: "install" },
  { id: "parametric-modeling", reference: "docs/product/feature-matrix.md", icon: "model" },
  { id: "mcp", reference: "docs/mcp-quickstart.md", icon: "agent" },
  { id: "export-and-print", reference: "docs/3d-printing.md", icon: "export" },
  { id: "privacy", reference: "docs/security-and-privacy.md", icon: "privacy" },
] as const
