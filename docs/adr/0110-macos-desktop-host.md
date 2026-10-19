# ADR-0110: macOS Desktop Host and Release Downloads

- Status: Accepted
- Date: 2026-10-19
- Superseded in part by: [ADR-0111](0111-native-project-assistant-and-handoffs.md) for native IPC and MCP attachment
- Related: [ADR-0004](0004-local-first-storage.md), [ADR-0008](0008-bun-workspaces.md),
  [ADR-0043](0043-local-stdio-mcp-browser-session.md), [ADR-0109](0109-local-declarative-ui-plugins.md)

## Decision

Add `apps/desktop` as an Electron host for the existing Vite production editor. Electron preserves
the Chromium runtime used for current CAD acceptance; Tauri would reduce packaging overhead but
introduce a different WebKit renderer on macOS. This is a runtime compatibility choice, not a measured
memory or speed comparison. Bun remains the package manager and build-script runtime. No external
Bun installation is required to run the packaged application.

The native main process owns one window, a dedicated persistent Chromium profile, a static server
at `http://127.0.0.1:43115`, native menus, and release downloads. Startup must exclusively bind that
port before loading the window. A conflicting listener causes refusal, never attachment, takeover,
or a fallback origin. Closing a macOS window retains the application; Quit closes its own server.

The renderer has sandboxing and context isolation, no Node integration, no preload or native IPC,
and no permission to navigate to remote applications. The document command path, browser persistence,
worker geometry, native format and export code remain authoritative. Native project backups are the
transfer path between browser and desktop profiles. Updates preserve the profile and origin.

The static editor serves files through the existing containment and security-header implementation
with an injected Node streaming reader. The Bun stdio host retains its file fast path. Only the
trusted built declarative-panel runtime asset accepts opaque-frame anonymous CORS; the editor,
other scripts and automation paths retain exact-origin restrictions. The desktop host does not
advertise an AI session or promote the development-only HTTP MCP transport to production. Existing
production MCP remains a separately launched stdio workflow.

## Updates and distribution

Use stable `desktop-vMAJOR.MINOR.PATCH` GitHub Releases in `kolengri/VibeShape`, with an exact
architecture-matched `VibeShape-VERSION-mac-ARCH.dmg` asset. Unrelated source releases, drafts and
prereleases do not select an update. Native startup checking is quiet when no eligible update exists
or the network is unavailable. The application menu provides an explicit check.

The main process validates bounded release metadata, HTTPS download locations, size and the
GitHub-advertised SHA-256 digest. Downloads stream into an exclusive temporary file and publish only
after verification, preserving existing destination files and removing failed partial downloads.
These checks establish transport/asset consistency, not independent publisher authentication.
Installation is explicit: the user quits and replaces the application from the downloaded image.
No executable is installed or launched by the update checker.

Packaging requires committed application source and the same verified controlled OCCT editor build
as local delivery. The app contains exact application and kernel/solver corresponding sources,
licenses and replacement instructions. Local builds are ad-hoc signed and verified. Public release
requires the existing compliance gate plus Developer ID signing and notarization; an ad-hoc local
build is not represented as a notarized public distribution. No signing secrets, login items,
release uploads, or background daemon are created by packaging.

See [macOS desktop delivery](../desktop-macos.md) for commands, evidence and operational limits.
