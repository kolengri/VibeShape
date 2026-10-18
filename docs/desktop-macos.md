# macOS desktop delivery

The Electron application packages the existing Vite editor and worker/WASM assets into
`VibeShape.app`. It runs without Terminal, an external browser, Bun, a cloud account, or a model API
key. The native host owns menus, a persistent app profile and a loopback static server. CAD editing,
history, assemblies, declarative UI plugins and export use the shared browser implementation.
See [ADR-0110](adr/0110-macos-desktop-host.md) for the boundary and update decision.

## Build and run

Use the Bun version pinned in `packageManager`. On macOS with Xcode command-line tools:

```sh
bun ci
bun run prepare:local /absolute/path/to/vibeshape-occt-compliance-bb368e271e24
bun run desktop:build
bun run desktop:start

# Commit source changes before making a source-matched package.
# The output directory must not already exist. Architecture defaults to this Mac.
bun run desktop:package /absolute/path/to/new-output-directory arm64 /absolute/path/to/vibeshape-occt-compliance-bb368e271e24
```

Packaging rebuilds the controlled editor from the current clean source; it never reuses a stale
`dist` prepared before a later application commit. The third argument selects the verified OCCT
bundle; omitting it uses the same default bundle directory as `prepare:local`.
The first Electron invocation downloads the pinned runtime and checks its upstream checksums.
Packaging also uses macOS `sips`, `iconutil`, `codesign` and `hdiutil`. It emits a runnable
`VibeShape-darwin-arm64/VibeShape.app`, a `VibeShape-0.1.0-mac-arm64.dmg`, `SHA256SUMS`, and a
`desktop-build.json` recording the source commit, editor inventory, main bundle and image digest.
The same script accepts `x64`; that target requires its own actual Mac acceptance evidence before
release. The local Apple Silicon artifact does not establish Intel compatibility.

Open the disk image, copy `VibeShape.app` to Applications and launch it. The current local artifact
is ad-hoc signed and verified, without Developer ID or notarization. Local ad-hoc signing leaves
Hardened Runtime off because it has no Team ID for library validation; the Chromium renderer
sandbox and context isolation remain enabled. A public signed/notarized release must use the
appropriate Hardened Runtime signing policy with its Developer ID identity. Do not disable Gatekeeper or
remove quarantine as part of the application workflow. Public distribution remains gated on
signing/notarization and the repository's release compliance review.

## Projects and lifecycle

The application uses `http://127.0.0.1:43115` and its own Chromium profile under
`~/Library/Application Support/VibeShape`. A second launch focuses the existing application. A busy
port produces a startup error; the app never opens an existing listener or chooses different storage.
The normal macOS window-close action keeps the app available in the Dock; Quit stops its server.

Browser profiles do not automatically become desktop projects. Save `.vshape` backups from the
browser, then open them through the existing Files and projects dialog in the app. Saved document
transactions survive restart. Uncommitted drafts and transient session Undo/Redo do not. Keep native
backups before replacing or rolling back the application; rollback does not reverse data migrations.

Core modeling works without network access. The desktop host does not expose a new production MCP
transport or an Enable AI session button. For agent authoring use the existing
[local stdio delivery](mcp-quickstart.md), with its browser-owned review and separate storage origin.
The experimental declarative panel plugins retain their existing sandbox and capability limits.

## Release checks and downloads

**VibeShape → Check for Updates…** checks public GitHub Releases. Startup also checks quietly;
network failures and an empty desktop release channel do not interrupt launch. An available update
offers an explicit download. The native Save dialog chooses its destination, progress belongs to the
window, and a completed verified image can be revealed in Finder. Quit VibeShape before replacing
the installed app. The checker never silently installs or opens downloaded software.

Release owners prepare a source-matched, reviewed build and complete signing/notarization and
compliance checks before publishing a stable GitHub Release:

- Tag: `desktop-v0.1.1` for desktop package version `0.1.1`.
- Apple Silicon asset: `VibeShape-0.1.1-mac-arm64.dmg`.
- Intel asset, only after target verification: `VibeShape-0.1.1-mac-x64.dmg`.
- Upload the image as a GitHub release asset with an advertised `sha256:` digest and matching size.
- Include checksums and corresponding-source provenance with the release.

The checker considers stable desktop tags, compares SemVer and selects the architecture-matched
asset. It ignores the separate OCCT source-release channel. Missing digests, invalid metadata,
unapproved redirects, oversized/interrupted downloads and hash mismatches fail without publishing a
partial image. HTTPS and GitHub's asset digest do not replace Developer ID authentication.

## Verification

```sh
bun run --cwd apps/desktop typecheck
bun test apps/desktop/src apps/mcp-server/src/static-editor.test.ts
bun run test:desktop
```

The native Playwright workflow launches Electron with an isolated development profile and exercises
the real editor, worker geometry, project persistence, backup download, window lifecycle, navigation
restrictions and menu integration. Update transport fixtures cover release selection and verified
streaming failure/success without publishing a GitHub release. Packaged-app verification must also
check the actual `.app`, its code signature and controlled assets. These local checks do not prove
Gatekeeper acceptance of a downloaded public binary or notarization.
