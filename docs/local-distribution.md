# Portable local distribution

The runtime package contains the built editor, its module worker and WASM, a bundled stdio MCP
server, a launcher, corresponding application source, and the existing controlled OCCT/SolveSpace
source and licensing assets. It needs an already installed **Bun 1.3.14** on `PATH`. Bun is not copied
into the package. No checkout, `node_modules`, account, model API, or network service is needed at run
time. The external MCP client provides reasoning; the browser editor has no embedded chat.

## Prepare from committed source

Prepare and verify the controlled editor first as described in [local deployment](deployment.md).
Then commit the accepted application, server, launcher, and package metadata changes locally. The
packager refuses dirty or untracked executable/package files. It copies the existing `apps/web/dist`
without rebuilding or modifying it and records its complete inventory before and after copying.

```sh
bun scripts/local-distribution-build.ts "/absolute/path/to/new portable package"
"/absolute/path/to/new portable package/vibeshape" verify
```

The output directory must be new. `manifest.json` records every payload file's size, SHA-256 and
executable flag, the committed source identity, pinned Bun version, and a deterministic release ID.
`sources/vibeshape-source.tar` comes from `git archive HEAD`; the controlled build's source archives,
notices and replacement instructions stay under `apps/web/dist/sources`. The complete inventory
must verify before installation or launch. Hashes detect corruption and unexpected changes; they
are not signatures proving the identity of a publisher. Keep the package from a trusted local build.
The content identity is deterministic; binary-reproducible compressed archives are not claimed.

The packager relies on the already accepted controlled dist and its recorded kernel/solver hashes.
Its app-source provenance requires preparing that dist from the same accepted application source;
the packager checks artifact identity, not a new independent rebuild. A complete public-release SBOM,
third-party notice review and legal review remain the [public licensing gates](licensing.md).

## Explicit launch

```sh
"/absolute/path/to/package/vibeshape" editor --port 43114
"/absolute/path/to/package/vibeshape" mcp --port 43114
```

Use one mode at a time on an available port. Editor mode runs in the foreground until Ctrl-C and
serves the static editor without an AI pairing bootstrap or API. For MCP, configure your client
explicitly to execute the package's absolute `vibeshape` path with arguments `mcp --port 43114`.
The client owns that process's lifetime; protocol stdout contains only MCP messages. Open the
reported loopback editor URL and enable its AI session when using MCP. An already paired MCP process
must stay with its owning client; these commands never stop it or discover and kill another PID.

Manual draft approval is the default. The bottom status bar's **AI connection and approval mode → Apply automatically → Set up auto-apply** explicitly enables valid allowlisted CAD
edits for this project and paired session only; **Auto-apply on** and **Stop AI** remain visible.
Approved local pairing and the chosen approval mode recover after reload or a temporary interruption on the same origin, project and client. Stop AI, project/client replacement and lease expiry require new consent. Durable bridge-restart recovery currently requires macOS or Linux; see [ADR-0095](adr/0095-local-mcp-continuous-recovery.md). See the
[MCP quickstart](mcp-quickstart.md) for review, Undo, and cancellation behavior.

Host and port select browser storage. Preserve the same `http://127.0.0.1:PORT` origin to reopen
committed projects. Changing a port selects different browser storage. Export `.vshape` backups
before an upgrade. Installing a package or selecting a version does not touch browser storage.

On macOS, double-click `Start editor.command` to start the foreground editor in Terminal. It prints
the same loopback URL; it does not open a browser automatically. Double-click `Install.command` only
when you want to install into `~/Applications/VibeShape`; it does not start the installed app or
register MCP. For another destination use the explicit `install DIRECTORY` command above or set
`VIBESHAPE_INSTALL_DIRECTORY` when invoking that wrapper. The installed root prints the exact MCP
executable and arguments for a later explicit client configuration change. These wrappers require
the existing Bun executable on the Terminal's `PATH`.

## Install, update and rollback

Choose an empty directory or a directory already managed by this installer. Absolute paths with
spaces are supported; symlinked source packages, destinations and parent paths are rejected.
On macOS `/tmp` and `/var` may be symlinks: choose their actual canonical path if installing there.

```sh
"/absolute/path/to/package/vibeshape" install "/chosen/VibeShape installation"
"/chosen/VibeShape installation/current/vibeshape" verify
"/chosen/VibeShape installation/current/vibeshape" editor --port 43114

# Upgrade from another verified package; running processes continue unchanged.
"/absolute/path/to/new package/vibeshape" install "/chosen/VibeShape installation"

# Read manifest.json for the earlier releaseId, then select that retained version.
"/chosen/VibeShape installation/current/vibeshape" rollback "/chosen/VibeShape installation" RELEASE_ID
```

Versions live in `versions/RELEASE_ID`. Their contents and directories become read-only; the
installer never overwrites an existing version and rechecks it before reuse. `current` is a relative
symlink replaced atomically only after a staged copy has verified. Rollback verifies a retained
version and changes only `current`. Old versions are retained, with no background updater or
automatic deletion. Unrelated destination files, unsafe links, altered versions and incomplete
inventories cause a refusal. Concurrent install/rollback operations fail while `.install-lock` exists.
Regular `.DS_Store` files created by macOS Finder are ignored and existing destination metadata is
preserved; metadata symlinks or directories are rejected. A damaged current release does not prevent
rollback to an intact retained version, and rollback preserves the damaged files for inspection.
If a process is interrupted during installation, inspect that directory manually before removing
the stale lock and retrying; the launcher does not assume that an existing lock is abandoned.

An update or rollback affects the next explicit launch. It never restarts a running editor or MCP
client, registers a server, edits configuration, installs a login item, or starts a daemon.
Restarting loses uncommitted drafts and transient Undo/Redo navigation; saved projects remain in
the browser. If a commit response was lost, inspect the actual model revision before retrying.
Rollback selects earlier application files. It does not reverse document-schema migrations or
guarantee that future migrated documents are readable by an older application; keep native backups.
