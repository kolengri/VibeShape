# macOS desktop delivery

For the Windows x64 portable application and cross-packaging, see [Windows desktop delivery](desktop-windows.md).

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
`VibeShape-darwin-arm64/VibeShape.app`, a `VibeShape-0.1.14-mac-arm64.dmg`, `SHA256SUMS`, and a
`desktop-build.json` recording the source commit, editor inventory, main/preload/MCP bundles and image digest.
The same script accepts `x64`; that target requires its own actual Mac acceptance evidence before
release. The local Apple Silicon artifact does not establish Intel compatibility.

Every package generates a branded drag-to-Applications disk image. Its background reuses the
Benchy wireframe-to-solid artwork with an arrow between the app and Applications. The repository-owned
AppKit renderer creates a 144 dpi background; Finder sets the mounted image to a fixed icon view.
Automation uses a unique temporary volume label and mountpoint basename, checks Finder's resolved
disk path before changing or closing its window, then restores the public `VibeShape` label by the
private mountpoint after all Finder work. It detaches before compression and verification, without
changing existing mounted installers or global Finder settings. An
interactive macOS session and normal Finder automation permission are required; failure refuses
the package rather than shipping an unformatted installer.

The generated application icon master is `apps/web/public/brand/app-icon.png` (1024 px).
Packaging exports all standard macOS icon sizes into the app's `.icns` resource. The browser
favicon and Apple touch icon use the same original Benchy wireframe-to-solid artwork.

Open the disk image, copy `VibeShape.app` to Applications and launch it. The current local artifact
is ad-hoc signed and verified, without Developer ID or notarization. Local ad-hoc signing leaves
Hardened Runtime off because it has no Team ID for library validation; the Chromium renderer
sandbox and context isolation remain enabled. A public signed/notarized release must use the
appropriate Hardened Runtime signing policy with its Developer ID identity. Do not disable Gatekeeper or
remove quarantine as part of the application workflow. The published Apple Silicon release channel
currently uses this explicitly disclosed ad-hoc delivery type. Developer ID signing and notarization
are required before describing a build as Apple-authenticated or notarized. Exact-source delivery and
the repository's release compliance requirements still apply.

## Projects and lifecycle

The application uses `http://127.0.0.1:43115` and its own Chromium profile under
`~/Library/Application Support/VibeShape`. A second launch focuses the existing application. A busy
port produces a startup error; the app never opens an existing listener or chooses different storage.
The normal macOS window-close action keeps the app available in the Dock and stops its chat agents;
Quit stops its server. Native traffic lights share the editor header. System menus invoke the same
eligible commands as the toolbar; focused text fields retain ordinary native editing behavior.

A bare launch opens the project chooser without creating or restoring a model. Choose a saved card,
create a project, or import a `.vshape` backup. Open-project tabs retain their document sessions and
switch the visible editor without stopping background project chat. Unfinished human editing still
blocks navigation; an agent turn or its project-owned review does not. Closing a tab does not delete
a project. Explicit `?project=<UUID>` links open that profile's matching project directly. Saved tab
IDs are distinct from the retained in-memory document sessions.
Each retained project consumes its own document worker and, when connected, ACP subprocess. Closing
an idle tab releases its session and chat resources; a tab with a running turn, queued message or
pending review must finish or cancel that work before closing. Ordinary tab switching keeps it alive.
Page exit closes the retained runtimes and native chat owners.

Editor windows disable Electron background throttling so their renderer-owned local MCP heartbeat
can continue while minimized or fully occluded. Auxiliary windows retain normal throttling. This
does not change pairing, broker expiry, OS sleep or explicit close/quit behavior, and it can increase
background CPU/GPU activity and battery use. A healthy background heartbeat does not prove that an
ACP subprocess or its upstream provider connection remains available.

Browser profiles do not automatically become desktop projects. Save `.vshape` backups from the
browser with **Save project (.vshape)**, then import them from the Projects page in the app. Saved document
transactions survive restart. Uncommitted drafts and transient session Undo/Redo do not. Keep native
backups before replacing or rolling back the application; rollback does not reverse data migrations.

Core modeling works without network access.
The experimental declarative panel plugins retain their existing sandbox and capability limits.
Only the owned editor's main frame may write text to the system clipboard. Clipboard reads,
subframe writes and unrelated permissions remain denied.

## AI connections

The built-in **AI chat** starts an installed ACP adapter. **Codex** selects `codex-acp`, which is
separate from the Codex CLI; `codex app-server` speaks Codex's own protocol rather than ACP.
VibeShape preserves inherited command precedence and adds `~/.local/bin`, `~/.bun/bin`,
`/opt/homebrew/bin`, and `/usr/local/bin` for Finder launches. It does not run shell startup files
or install adapters. Use **Advanced connection** to provide an absolute executable path and a JSON
argument array for another installation. Connection failures produce one operational notification
with recovery guidance; reconnect after correcting the command or authentication.

Each embedded connection supplies a project-stable internal MCP server name, so an unrelated
disabled `vibeshape` entry in the adapter's user configuration does not suppress the project tools.
Connecting the built-in chat authorizes reads and validated model changes in that project. Valid
stages save through the ordinary revision-checked commit path without a second Apply action.
Copied desktop external MCP clients automatically receive the current project with manual Apply
under [ADR-0130](adr/0130-default-desktop-external-mcp-access.md). **Stop AI** revokes all
current-project transports and persists across reload. Deliberate **Connect** restarts the built-in
assistant; **Restart local MCP** in Settings > Connections restarts the external client.

The composer footer shows the connected agent's advertised session configuration, including
model-specific reasoning effort when provided. Choices and effective values come from ACP;
changing a model may replace the available reasoning levels. Legacy mode/model controls are
fallbacks, so the same setting is not shown twice. Project-access and MCP-attachment status belong
to the global footer rather than a repeated chat summary. An ACP connection alone does not prove
that its MCP client has attached or that the person has granted access to the model.

Connecting the same agent configuration in another project or after application restart restores
accepted user model, mode, and session-option choices before the connection becomes ready.
Restoration uses the new session's advertised catalog, applies the model before dependent options,
and verifies effective values. Unsupported saved choices fail visibly before ready and are removed
from later restoration attempts. Choices are shared by exact agent configuration; project access,
session tokens, credentials, conversation and Stop AI remain independently scoped to each project.
The desktop profile stores only validated accepted runtime choices in a private, versioned file
bounded to 64 KiB and 128 agent configurations. Missing, unreadable or malformed preference files
restore no choices. Stale responses cannot overwrite a replacement session, and reconnecting does
not replay modeling commands.
Preference writes are best-effort: a disk failure does not turn an already-applied agent setting
into a failed request. Accepted choices remain available across projects in the running host;
they survive restart only after a successful save. A later settings change retries persistence.
Temporary failures of the embedded ACP or its project automation connection trigger up to five
automatic recovery attempts with backoff. The chat shows recovery progress; after exhaustion it
offers an explicit retry. Stop, Disconnect, revoked access, authentication requirements and permanent
configuration failures do not silently reconnect. A brief ready notification does not reset the
failure budget. Accepted settings remain available throughout recovery. If the agent no longer
advertises a saved choice, restoration fails visibly instead of claiming the settings were restored.
An unavailable private project attachment during host registration uses the same bounded recovery
loop. Discovery grants no access, and Stop AI still prevents restoration and fresh pairing.

An interrupted turn continues only after the provider reloads the exact resumable session and the
project settles accepted persistence work. The new turn first reconciles the authoritative model,
draft and revisions; it never resends the interrupted prompt or uncertain CAD writes. A provider
without session restoration reports that limitation instead of starting an unrelated conversation.
Recovery does not open the configuration drawer or move the transcript reading position.

After authenticated local resume, the assistant can inspect `list_recoverable_drafts` and explicitly
adopt compatible semantic intent with `restore_draft`. Adoption requires the exact committed base,
creates a new private draft attributed to the current actor, and still requires ordinary preview
and commit. Bounded tab-memory retention does not survive reload or Stop; it never replays an
uncertain saved write. See [ADR-0119](adr/0119-explicit-private-draft-recovery.md).
Each recovery owner has its own five-attempt budget; ordinary bounded delivery-envelope retries
remain separate. Accepted writes from the interrupted turn are sealed before continuation takes a
new internal checkpoint under the recovered actor. If continuation changes the model, its latest
Undo/View before target covers that continuation; earlier accepted writes remain in document history.


Session controls use fixed grid tracks determined by the composer's width. Changing a selected
label does not move the controls or resize the composer; long labels truncate in the trigger and
remain complete in its menu. Narrow composers place attachment and turn actions below the settings.
Each menu also shows the setting's advertised name and description, so values such as On/Off retain
their context without adding labels above the composer.

Attachments send actual UTF-8 text as embedded ACP resources and supported PNG/JPEG/WebP/GIF
images as ACP image blocks, only when advertised by the agent. Limits are five files, 2 MiB per
text file, 5 MiB per image, and 12 MiB combined per message. PDF and other binary formats are not
silently treated as readable documents. File contents stay in memory; saved transcripts retain
their names, not a durable attachment archive. Attachment content is task data, never application
instructions or permission to read an arbitrary filesystem path.

The native project's private MCP attachment advertises `ask_user_question`, independently of an
agent harness's own input tool or ACP elicitation forwarding. It calls the desktop's existing
question owner through a captured project/session and MCP transport generation. ACP form
elicitation remains supported by that same owner; assistant prose never creates a form. Questions
accept bounded non-secret string fields and advertised choices, including an optional custom-answer
field when supplied. Unsupported form types are declined. Replies validate field values, ownership
and the absolute expiration deadline. Duplicate, stale and late replies cannot settle a form again.

An unanswered form blocks dependent CAD calls, queue drain, steering and recovery continuation,
including when the provider reports ready prematurely. A valid reply releases that wait. Dismissal,
expiry, Stop and disconnect cancel the question and pause queued work without granting an answer.
Native forms normally live for five minutes; providers can impose a shorter MCP call timeout.
The host cannot extend a provider-owned timeout through generic ACP configuration.

Sending while a turn is running queues the message rather than silently canceling or steering it.
The controller accepts up to eight queued messages with a bounded memory budget and sends them in
order after successful turns. Stop, explicit disconnect or terminal failure pauses the queue;
Resume is explicit. Successful automatic recovery continues previously unpaused, unsent work only
after the interrupted turn has been reconciled and completed.
Pending queued messages can be removed, and New chat does not discard them implicitly. Queued
attachment bytes remain in memory and are not a durable job store. Accepted turn text is saved in
the transcript so an asynchronous provider failure does not overwrite a newly edited composer.

Providers advertising active steering expose **Steer now** on queued messages while working. It
delivers the exact queued text and attachments to the existing provider session without canceling
the current prompt. Delivery locks that item; confirmed acceptance removes only it, while failure
retains it and pauses the queue. Unsupported providers and direct Chat Completions explain why
active steering is unavailable. If the provider has already finished and reports a new turn, the
UI reports that outcome and retains output tracking until authoritative provider completion;
acknowledgement alone does not mark the turn finished. Stop and project/session fences still apply.

Every native prompt identifies its project and instructs the agent to establish live project
identity and geometry through the supplied VibeShape MCP tools before modeling. The private agent
working directory is not the model. These instructions preserve exact preview, project and revision checks, and ordinary commit
authority. They describe connected model access and exclude substitute filesystem CAD generation.

Open **Settings → Connections → Connect an MCP client**, copy the configuration, and add it to the
external client's MCP settings. It launches the app's bundled stdio forwarder with Electron's own
runtime and attaches to this open application. It does not launch another editor or require Bun.
The copied configuration permits one external native MCP client at a time. Selecting or opening a
project grants current-project read and proposal access automatically, with no Enable AI session
option in desktop status. Manual Apply remains the default; supported auto-apply and project
management require separate explicit choices. Stop AI revokes its drafts and persists across reload
and project navigation until **Restart local MCP** in Settings > Connections. The private credential is
not included in the copied configuration. Quit/restart creates a new native descriptor.

The **AI chat** panel connects an installed ACP executable with explicit arguments and uses the
person's own agent account. Its configured executable becomes available in each project without
manual reconnection. Each project has its own ACP process, conversation, queue, MCP credential,
document authority and review state. Switching tabs retains an ongoing turn in its source project;
returning shows that project's accumulated updates and pending review. Embedded agents cannot use
project-management tools or redirect their tools to another project. Messages and tool progress stay
tied to that project. Stop cancels
the response; New chat starts a new conversation. Transcripts persist locally per project and are not included in `.vshape` backups. Native
context restoration depends on the agent's advertised support. Both built-in native and browser API chats use connected model authority under
[ADR-0116](adr/0116-connected-assistant-model-authority-and-checkpoints.md). Their model changes
appear incrementally and commit without separate Apply prompts. External clients retain their own
approval policy. Each assistant turn has an internal checkpoint; **View before** temporarily shows
the earlier model, and **Undo agent changes** restores the saved turn atomically. These controls
add no parametric History rows and reject stale targets after unrelated edits. The local agent has ordinary user OS privileges even though
VibeShape advertises no ACP filesystem or terminal capabilities.

Replacing or disconnecting a project's ACP agent waits for bounded cleanup of its process and captured MCP
connection. Reopening a closed window preserves that cleanup barrier; Quit drains cleanup before
stopping the native server. Other projects' agents and the external MCP attachment have separate
leases. Discovery and ACP readiness alone do not grant model access. The built-in chat selects its trusted
project policy; the external desktop broker requires descriptor authentication and the renderer
requires both trusted preload and desktop discovery policies. Standalone browser/development and
remote brokers retain their explicit pairing and approval rules.

The static web application instead connects directly to a user-provided compatible model API. No
VibeShape AI server or hosted worker is needed. The provider must allow the browser origin through
CORS. API credentials remain in runtime memory, and model calls happen only after an explicit Send.
Existing CAD WebWorkers continue to compute geometry on the person's device.
Browser chat discovers and executes CAD through `discover_cad_tools` and `call_cad_tool`; its separate
`ask_user_question` function requests the same bounded non-secret form answers. API forms expire
after two minutes. Dismissal, expiry or Stop ends dependent same-response tool execution and pauses
the queue rather than returning a successful empty answer.

### Recover an unavailable native agent session

Use this procedure for a project whose ACP test succeeds but whose chat cannot connect:

1. Keep the affected project open and confirm its save status is **Saved**. Preserve its transcript;
   do not clear browser storage or create a replacement project to repair agent context.
2. Open **AI settings**. For an external ACP agent, **Test connection** checks process startup and
   the protocol handshake only. It does not open the saved conversation or verify CAD access.
3. Choose the intended agent and click **Connect agent**. VibeShape first attempts the saved session.
   When Codex reports `no rollout found for thread id` for that exact session, this explicit action
   starts a new agent session. The saved model, display transcript, and accepted agent settings remain.
   The new agent context does not contain the old provider conversation. Automatic recovery stops
   on this permanent failure rather than repeatedly loading the missing thread.
4. Confirm the message field is enabled and the footer shows project AI access. Model loading and
   project pairing are separate from ACP initialization; a complex model may still be settling.
5. If work was interrupted, first inspect the saved model and recoverable drafts before requesting
   further changes. An uncertain CAD action may already have committed. Reconnection never resends
   that action or the interrupted prompt.

Authentication, settings, protocol, and transport errors do not trigger the missing-session fallback.
If connection still fails, record the project name/ID, saved revision, exact error message, and whether
the failure occurs during the ACP test, session restoration, or model pairing. Diagnose that layer
before another retry. Do not include credentials or private MCP descriptors in shared evidence.

## Mesh handoff

**Export model → Send to slicer** sends STL or 3MF directly to a detected installed application or
one selected through the native application chooser. Mesh quality and authored export scope retain
their ordinary meaning. The app prepares a private temporary file and opens the slicer without a
separate bridge or pairing token. If launch fails, **Show mesh in folder** reveals the retained file.
Before accepting another mesh, the desktop counts files and logical bytes still present in its owned
handoff directories, including files from earlier app processes. It refuses an addition that would
exceed 32 files or 512 MiB; an expired reveal ID does not free storage capacity while its file remains.
Recent handoffs are preserved across restart, and removing a file or stale-file cleanup restores
capacity. Reveal IDs remain limited to the current app session.
The browser offers a download for manual opening. Slicer launch does not prove successful import,
correct printer settings, slicing, or printing.

## Release checks and downloads

For a single manual build, native acceptance and publication run, see
[automated desktop releases](desktop-release.md).

**VibeShape → Check for Updates…** checks public GitHub Releases. Packaged applications also check
quietly at startup. Source-checkout launches skip automatic checks so release dialogs cannot
interrupt development or isolated native tests; the manual menu action remains available.
Network failures and an empty desktop release channel do not interrupt launch. An available update
offers an explicit download. The native Save dialog chooses its destination, progress belongs to the
window, and a completed verified image can be revealed in Finder. Quit VibeShape before replacing
the installed app. The checker never silently installs or opens downloaded software.

Release owners prepare a source-matched build, complete its applicable runtime and compliance
checks, and disclose its actual signing/notarization status before publishing a GitHub Release.
The current Apple Silicon channel is ad-hoc signed and not notarized; it must not claim Developer ID
authentication. A Developer ID release additionally requires its signing and notarization checks:

- Tag: `desktop-v0.1.14` for desktop package version `0.1.14`.
- Apple Silicon asset: `VibeShape-0.1.14-mac-arm64.dmg`.
- Intel asset, only after target verification: `VibeShape-0.1.14-mac-x64.dmg`.
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

The manual `macOS release validation` workflow runs packaged acceptance on a separate Apple Silicon
`macos-15` runner. Upload the DMG, `desktop-build.json` and `SHA256SUMS` to a draft release, then
supply its `desktop-vX.Y.Z` tag, exact artifact source commit and independently verified DMG SHA-256.
The workflow verifies the receipt and digest, checks the disk image, mounts it read-only, copies the
actual application, verifies its code signature and architecture, and runs `test:desktop:packaged`
with an isolated profile. It records the artifact source separately from the acceptance harness
commit. This avoids the installed application's fixed-port conflict on the developer's Mac.
Publish the same draft only after both platform acceptance workflows succeed; do not replace their
validated assets. The check does not establish notarization or Gatekeeper acceptance.

`test:desktop` rebuilds the native host but serves the existing `apps/web/dist` renderer. Run the
current web build before integrated UI acceptance; an old renderer directory cannot establish the
freshness of icons or frontend behavior. The background-session regression uses a temporary profile
and dynamic port, minimizes the actual editor for more than its broker lease, and verifies continued
authenticated polling and fake ACP CAD reads without opening the installed app.
