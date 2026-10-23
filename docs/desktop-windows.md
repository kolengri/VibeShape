# Windows desktop delivery

The Windows x64 application uses the same Electron host, Vite editor and worker/WASM assets as the
[macOS application](desktop-macos.md). It bundles its runtime: opening `VibeShape.exe` does not
require Bun, Node, a terminal, a cloud account or a model API key. Windows retains its standard title
bar and window controls. Closing the last window quits the application.

## Build and package

Use the Bun version pinned in `packageManager`. Development commands work in PowerShell:

```powershell
bun ci
bun run prepare:local C:\build\vibeshape-occt-compliance-bb368e271e24
bun run desktop:build
bun run desktop:start

# Commit source changes first. The destination must not already exist.
bun run desktop:package:windows C:\build\windows-output x64 C:\build\vibeshape-occt-compliance-bb368e271e24
```

The existing [verified OCCT compliance bundle](local-distribution.md) is required; packaging refuses
the npm feasibility kernel and stale editor builds. The command also works on macOS without Wine,
Xcode, Finder automation or Windows SDK tools. It uses the pinned `@electron/packager` Windows
resource editor and the repository's `.ico` container of the existing application artwork. Windows
uses its built-in `tar` ZIP support; macOS uses `ditto`. Cross-packaging is artifact evidence, not
proof of successful execution on Windows.

Output contains `VibeShape-win32-x64/`, `VibeShape-VERSION-win-x64.zip`, `SHA256SUMS-win-x64` and
`desktop-build-win-x64.json`. Windows metadata names allow the Mac receipt and checksum manifest
to coexist in the same GitHub release. The build receipt records the exact source commit, target platform, editor
inventory, native bundle hashes and ZIP digest. The complete application source, CAD engine source
archives, replacement instructions and runtime license notices accompany the editor under
`resources/editor/sources/`. Electron notices come from the target Windows runtime. Packaging
preserves the existing clean-source and failure-cleanup guarantees.

## Install and update

Extract the **entire** ZIP into a writable local directory and open `VibeShape.exe` inside it. Keep
the DLLs, data files and `resources` directory alongside the executable. The archive is unsigned:
Windows may show an unknown-publisher or SmartScreen warning. It is not an Authenticode-signed
installer. Do not describe a source build as a published release. Native ARM64, MSI, Start-menu
registration and Windows code signing are outside this delivery.

Projects live in the current user's Electron application profile, normally
`%APPDATA%\VibeShape\User Data`, independently of the extracted application directory. A custom
`--user-data-dir` selects the containing directory; Windows browser data lives in its `User Data`
child. Electron can create the container before application code runs, so VibeShape creates and
protects this separate child with current-user ownership before selecting it as the browser profile.
An existing child with another owner is refused; the app does not take ownership or change profiles
on failure. Earlier local Windows test builds used the container itself; export `.vshape` backups
from those builds before switching, because their browser data is not moved automatically.

Back up important projects as `.vshape` files before moving machines or deleting the profile. The editor retains
`http://127.0.0.1:43115`; an occupied port fails startup instead of opening another listener or
changing the storage origin.

Check for Updates selects only a newer stable `desktop-vMAJOR.MINOR.PATCH` release with the exact
`VibeShape-VERSION-win-x64.zip` asset. It never substitutes a Mac DMG or an ARM64 archive. Downloads
retain bounded metadata, HTTPS host restrictions, size and SHA-256 verification, cancellation and
existing-file preservation. After downloading, quit VibeShape, extract into a new directory and
open the new executable. Updates do not replace running binaries or the project profile.

## Native connections

Settings → Connections provides the existing MCP launch configuration with absolute Windows paths,
including UNC paths and the extended `\\?\` drive and UNC forms.
The bundled Electron runtime runs its stdio forwarder; keep the desktop app open. Authenticated
external clients receive the current project automatically with manual Apply by default. Stop persists
until Restart local MCP in Settings > Connections. Document authority,
project identity and revocation follow the [native integration policy](desktop-macos.md#ai-connections).
The native workflow directory and its credential descriptor use Windows ACLs rather than POSIX
permission bits. Private-file validation fails closed if Windows cannot establish those permissions.

Direct ACP connections require executable programs. For a JavaScript adapter installed through npm,
configure the absolute `node.exe` command and put the adapter's JavaScript entrypoint in its argument
array. Jev's Argument model additionally resolves standard npm `.cmd` launchers from PATH or an
explicit path to their Node script. It uses `node.exe` next to the shim when present, otherwise the
first Node executable on PATH. This supports the installed Codex, Claude Code and OpenCode presets
without evaluating a shell wrapper. Other interpreters or interpreter options require an explicit
executable/argument configuration. External ACP adapters and their authentication remain separately
installed; CAD itself does not require them.

Jev's local argument helper uses the system Windows PowerShell/.NET runtime to own a
kill-on-close Job Object before starting the selected agent. This contains backend descendants
even when the ACP leader exits or the Jev host is terminated. Policy restrictions on PowerShell
or `Add-Type` cause a launch failure; there is no unsupervised fallback. See the
[Jev connection guide](jev-agent.md#configure-and-connect) for settings and limits.

Installed-slicer discovery receives Windows installation roots and PATH. Custom slicers are selected
as `.exe` files, remembered in the private profile and launched with argument arrays. Mesh retention,
failed-launch recovery and the absence of slicing or printer traffic match the Mac workflow.

## Verification and release limits

For a single manual build, native acceptance and publication run, see
[automated desktop releases](desktop-release.md).

`Windows desktop` runs automatically as a required gate in `Desktop release` before packaging,
and can also be dispatched manually for diagnosis. It does not run on every pull request; normal
PR CI remains enabled, but Windows-specific regressions may be discovered only during release
preparation. The release caller passes the exact reserved release commit to checkout.
The workflow runs Windows x64 target/ZIP/update/schema/private-file checks, builds the native
host and source editor, checks local-agent probing and process launch, and exercises CAD creation
and project persistence through real Electron.
Its source editor uses the normal feasibility build; it does not certify a controlled release.
`bun run test:desktop` selects this Windows smoke test on Windows and retains the existing Mac
suite on macOS.

For acceptance of the actual extracted release, run on Windows with the pinned Bun:

```powershell
$env:VIBESHAPE_PACKAGED_APP = 'C:\build\VibeShape-win32-x64'
bun run test:desktop:packaged
```

Run packaged acceptance in an isolated Windows account without an existing VibeShape profile.
It launches without `--user-data-dir`, checks the fresh default profile, creates and reopens a CAD
model, and connects the bundled MCP forwarder automatically with manual approval and Stop AI
revocation. The test refuses an existing default profile and removes only the profile it creates.

The manual `Windows release validation` workflow performs this check against a draft GitHub
release. Upload the ZIP, `desktop-build-win-x64.json` and `SHA256SUMS-win-x64`, then supply its `desktop-vX.Y.Z`
tag, exact source commit and independently verified ZIP SHA-256. The workflow checks the receipt,
manifest and digest before extracting and executing the archive. Publish that same draft only
after acceptance succeeds; do not replace its validated assets.

Require successful controlled-kernel CAD creation/reopen and native connection tests on Windows
before publishing or describing a Windows artifact as release-verified. A Mac build or a skipped
Windows test does not satisfy that gate.
