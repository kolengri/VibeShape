# macOS desktop delivery

The Electron application packages the existing Vite editor and worker/WASM assets into
`VibeShape.app`. It runs without Terminal, an external browser, Bun, a cloud account, or a model API
key. The native host owns menus, a persistent app profile and a loopback static server. CAD editing,
history, assemblies, declarative UI plugins and export use the shared browser implementation.
See [ADR-0110](adr/0110-macos-desktop-host.md) for delivery and updates and
[ADR-0111](adr/0111-native-project-assistant-and-handoffs.md) for native project integration.

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
Packaging also uses macOS `sips`, `iconutil`, `codesign`, `hdiutil`, Swift/AppKit and
`osascript`/Finder. It emits a runnable
`VibeShape-darwin-arm64/VibeShape.app`, a `VibeShape-0.1.0-mac-arm64.dmg`, `SHA256SUMS`, and a
`desktop-build.json` recording the source commit, editor inventory, main/preload/MCP bundles and image digest.
The same script accepts `x64`; that target requires its own actual Mac acceptance evidence before
release. The local Apple Silicon artifact does not establish Intel compatibility.

Every package generates a branded drag-to-Applications disk image. Its background reuses the
calibration-tugboat artwork with an arrow between the app and Applications. The repository-owned
AppKit renderer creates a 144 dpi background; Finder sets the mounted image to a fixed icon view.
Automation targets only the uniquely mounted staging folder, closes its own window and detaches
the image before compression and verification. It does not change global Finder settings. An
interactive macOS session and normal Finder automation permission are required; failure refuses
the package rather than shipping an unformatted installer.

The generated application icon master is `apps/web/public/brand/app-icon.png` (1024 px).
Packaging exports all standard macOS icon sizes into the app's `.icns` resource. The browser
favicon and Apple touch icon use the same original calibration-tugboat artwork.

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
The normal macOS window-close action keeps the app available in the Dock and stops its chat agent;
Quit stops its server. Native traffic lights share the editor header. System menus invoke the same
eligible commands as the toolbar; focused text fields retain ordinary native editing behavior.

A bare launch opens the project chooser without creating or restoring a model. Choose a saved card,
create a project, or import a `.vshape` backup. Open-project tabs switch using ordinary draft/save/AI
guards; closing a tab does not delete a project. Explicit `?project=<UUID>` links open that profile's
matching project directly. Tabs remember open IDs, not separate mutable model copies.

Browser profiles do not automatically become desktop projects. Save `.vshape` backups from the
browser with **Save project (.vshape)**, then import them from the Projects page in the app. Saved document
transactions survive restart. Uncommitted drafts and transient session Undo/Redo do not. Keep native
backups before replacing or rolling back the application; rollback does not reverse data migrations.

Core modeling works without network access.
The experimental declarative panel plugins retain their existing sandbox and capability limits.
Only the owned editor's main frame may write text to the system clipboard. Clipboard reads,
subframe writes and unrelated permissions remain denied.

## AI connections

Open **Settings → Connections → Connect an MCP client**, copy the configuration, and add it to the
external client's MCP settings. It launches the app's bundled stdio forwarder with Electron's own
runtime and attaches to this open application. It does not launch another editor or require Bun.
Only one native MCP client attaches at a time. Select a project, then enable its AI session before
the client can inspect or modify it; disabling access revokes its drafts. The private credential is
not included in the copied configuration. Quit/restart creates a new native descriptor.

The **AI chat** panel connects an installed ACP executable with explicit arguments and uses the
person's own agent account. Messages and tool progress stay tied to the current project. Stop cancels
the response; New chat starts a new conversation. Transcripts persist locally per project and are not included in `.vshape` backups. Native
context restoration depends on the agent's advertised support. CAD changes retain preview and the
person's existing MCP approval policy, including any explicit auto-apply consent. The chat cannot
grant that consent to itself. Browser API chat always requires manual Apply. The local agent has ordinary user OS privileges even though
VibeShape advertises no ACP filesystem or terminal capabilities.

Replacing or disconnecting an ACP agent waits for bounded cleanup of its process and captured MCP
connection. Reopening a closed window preserves that cleanup barrier; Quit drains cleanup before
stopping the native server. A different MCP client is never disconnected to make room for chat; if
a client remains attached, the connection reports the existing client conflict.

The static web application instead connects directly to a user-provided compatible model API. No
VibeShape AI server or hosted worker is needed. The provider must allow the browser origin through
CORS. API credentials remain in runtime memory, and model calls happen only after an explicit Send.
Existing CAD WebWorkers continue to compute geometry on the person's device.

## Mesh handoff

**Export model → Send to slicer** sends STL or 3MF directly to a detected installed application or
one selected through the native application chooser. Mesh quality and authored export scope retain
their ordinary meaning. The app prepares a private temporary file and opens the slicer without a
separate bridge or pairing token. If launch fails, **Show mesh in Finder** reveals the retained file.
Before accepting another mesh, the desktop counts files and logical bytes still present in its owned
handoff directories, including files from earlier app processes. It refuses an addition that would
exceed 32 files or 512 MiB; an expired reveal ID does not free storage capacity while its file remains.
Recent handoffs are preserved across restart, and removing a file or stale-file cleanup restores
capacity. Reveal IDs remain limited to the current app session.
The browser offers a download for manual opening. Slicer launch does not prove successful import,
correct printer settings, slicing, or printing.

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
unapproved redirects, oversized/interrupted downloads and hash mismatches fail before copying an
image to its final name. HTTPS and GitHub's asset digest do not replace Developer ID authentication.
The selected destination is checked before transfer; an occupied path opens the Save dialog again
without repeating the release lookup. Final creation remains exclusive to refuse a later collision.
Verified bytes are copied through an owned destination handle rather than a hard link, so writable
volumes such as exFAT and FAT do not need hard-link support. Publication is not an atomic rename:
the ready dialog appears only after copying and closing the destination. Cancellation and ordinary
copy failures clean up owned incomplete files, and shutdown waits for that cleanup.
Update dialogs select typed catalog messages for network, HTTP, metadata, integrity and destination
failures; raw transport and filesystem diagnostics are never interpolated into their product copy.

## Verification

```sh
bun run --cwd apps/desktop typecheck
bun test apps/desktop/src apps/mcp-server/src/static-editor.test.ts
bun run test:desktop
VIBESHAPE_PACKAGED_APP=/absolute/path/to/VibeShape.app bun run test:desktop:packaged
```

The native Playwright workflow launches Electron with an isolated development profile and exercises
the real editor, worker geometry, project persistence, backup download, window lifecycle, navigation
restrictions and menu integration. Update transport fixtures cover release selection and verified
streaming failure/success without publishing a GitHub release. The guarded packaged-app command
reuses the CAD, backup, persistence, restart and OS-sandbox checks against the actual bundle with no
Bun on its runtime `PATH`; it catches signing/loader failures that a development Electron launch or
signature verification alone cannot establish. It also checks the packaged license endpoints.
Packaged-app verification must also check its code signature and controlled assets. These local checks do not prove
Gatekeeper acceptance of a downloaded public binary or notarization.
