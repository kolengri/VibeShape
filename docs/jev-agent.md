# Built-in Jev ACP controller

The native chat offers **Jev (TypeSafe)** as its own agent choice. The desktop ships the existing
`apps/jev-agent` adapter and runs it using Electron's embedded Node runtime. There is no external
Bun installation, executable path or source-checkout requirement for this choice. Jev uses the
host's existing injected project MCP server; it does not create another editor profile or CAD API.
Browser-only chat cannot launch the bundled local process.

## Control loop

1. Discover the injected MCP catalog and load the bundled `vibeshape-use` instructions.
2. Read `model_info`, retaining the actual project identity and revision.
3. Send the goal, retained session context, a bounded recent observation history, operator instructions
   and optional images to Jev.
   One request uses the complete tool descriptions to select a tool and speculate on its closed
   argument values. The selector catalog stores descriptions once, keyed by action ID; tool names
   belong to action choices and argument schemas belong to parameter questions. Only the selected
   branch's answers are consumed.
4. If arguments need free text, numbers, identifiers or nested geometry, send only the selected
   tool's full schema to the separately configured small language model and request a JSON argument
   object. Preserve the values and omissions Jev selected.
5. Recheck project identity and revision. Discard a stale decision without executing it. Validate
   arguments against VibeShape's existing tool schemas and execute one MCP call.
6. When the selected branch falls below the confidence threshold, ask the configured argument
   model to select one next action from the compact advertised catalog, then complete that tool's
   arguments separately. This can select `ask_user_question` for missing design details. The
   replacement goes through the same project, revision and schema checks; no tool has run yet.
7. Record its result and repeat until the selected action is `done` or `blocked`, a tool fails
   with a diagnostic other than `command-no-op`, or cancellation arrives. There is no decision-count
   limit. Without a helper, an uncertain selection asks for argument-model configuration
   instead of reporting an internal threshold failure.

Jev chooses actions rather than generating CAD code. Required closed parameters and optional closed
parameters with an omission alternative can be selected in the same request as the tool. Open
parameters use the helper model; arbitrary dimensions are not inferred from a probability score.
This implementation does not yet generate numeric candidate grids or compile all nested JSON
Schema alternatives into questions.

The normal MCP draft, preview, command-budget, revision, persistence and checkpoint policies remain
authoritative. The controller cannot switch or create projects. A validated `command-no-op`
diagnostic confirms that the feature already has the requested state. The controller retains the
tool's diagnostic and continues with a fresh model read and decision, without replaying the action.
Other rejected actions stop the turn and include the reported code and message when available.
An uncertain action stops the turn and is never automatically replayed. After an uncertain write,
the process permits only read-only inspection. Inspect saved state and reconnect before authoring
again; an unchanged saved revision does not establish the outcome of an unsaved draft operation.
Native **Stop AI** still revokes project authority.
Jev's `done` is a stopping decision, not independent proof of geometric or manufacturing correctness.

Prior requests, validated accepted answers, the latest successful modeling, assembly or restored draft receipt and read skill
URIs remain available to both Jev and the argument helper outside the rolling observation history.
A continuation retains the original task and later corrections. Identical questions within one
turn reuse their validated answer; no second dialog opens. The message and field definitions must
both match, so different questions with generic field names still ask for their own answer.
Changed fields or a new user turn can also ask a fresh question. Retained answers are task data, not new
authority. Successful commit or discard clears the active draft receipt.

## Configure and connect

Open **AI settings** from the chat header. Settings open in a modal dialog; closing it preserves
the current form and connection. Successfully saving and connecting closes the modal; pending or
failed connections and settings-storage failures leave it open for correction.
Select **Agent → Jev (TypeSafe)**. Enter the TypeSafe API key and
Jev model. The default model is the adapter's pinned `jev-1.14.0`; selecting it does not establish
that the provider account has access to that model.

Switching agents discards the previous agent's saved resume record and starts a fresh native
session, including when returning from Jev to an earlier agent. Reconnecting to the same agent
first attempts its advertised session-resume behavior. If Codex definitively reports that the saved
thread has no rollout, explicit **Connect agent** starts a new agent session while preserving the
project and display transcript. Automatic recovery stops with a specific error instead of replacing
missing context or replaying a prompt; other startup errors do not trigger this fallback.
Provider-scoped model settings remain separate from session history and are preserved when switching
back. Follow the [native session recovery procedure](desktop-macos.md#recover-an-unavailable-native-agent-session)
when the ACP test succeeds but the project chat cannot connect.

Choose **Argument model → Codex / Claude Code / OpenCode** to reuse the installed ACP agent's
existing sign-in. A previously saved custom ACP command is also available and selected when switching
from that agent to Jev. The choices are launch presets, not a claim that an executable is installed
or authenticated; use **Test connection** to check access. No helper API key is needed.
Most CAD edits need this helper for dimensions and references. Jev normally selects the action;
the helper fills its open arguments and resolves low-confidence action selections. Each request starts a fresh ACP process in a temporary
empty working directory, without the project MCP attachment or client filesystem/terminal
capabilities. Permission requests are declined. The helper inherits OS/configuration paths for its
existing sign-in, but no TypeSafe or argument-provider keys. It retains the local agent's ordinary
OS privileges; these restrictions are not an OS sandbox. Stop, timeout and normal host shutdown
terminate the helper process. Starting a process per completion adds unmeasured startup overhead.
On Windows, the helper runs beneath an inbox PowerShell/.NET supervisor assigned to a
kill-on-close Job Object before launching the agent. Its descendants inherit job membership;
leader exit, cancellation and host termination close the owning process and terminate the job.
Jev waits for a private per-launch readiness receipt on stderr before sending ACP initialization;
supervisor setup remains within the request's existing deadline.
The supervisor imports the inbox `Microsoft.PowerShell.Utility` manifest directly from `$PSHOME`
before calling `Add-Type`, avoiding automatic discovery across installed modules.
The Windows local-agent connection probe allows up to 50 seconds within the configured request
timeout, with a 60-second desktop deadline to include startup and cleanup. This accommodates
cold PowerShell/.NET setup; API and other-platform probe budgets remain 20 seconds in Jev.
The supervisor also waits on the host process handle, because forced Windows process termination
cannot run JavaScript signal handlers. Arguments are passed as data; `CreateProcessW` explicitly
assigns stdin/stdout/stderr and limits handle inheritance to those three streams. No shell command
evaluates the agent arguments. A blocked PowerShell or `Add-Type` policy
fails the launch without an unsupervised fallback. Temporary-directory removal has bounded retries
for asynchronous Windows handle release. Job termination is not a promise of synchronous OS reaping.
On POSIX, SIGTERM/SIGINT cancel active helpers and wait for all their temporary-directory cleanup
before Jev exits. Forced process termination can still leave temporary directories.
Standard Windows npm `.cmd` launchers are resolved to their Node entrypoint before supervision;
`node.exe` is selected beside the shim or from PATH. The wrapper itself is not executed. Launchers
with another interpreter or interpreter options fail with guidance to configure an explicit
executable and arguments. Direct native executable commands retain their argument arrays.
For a bounded Windows startup investigation, `VIBESHAPE_ARGUMENT_TRACE` can point to a diagnostic
JSON-lines file. It records supervisor stages, UTC times and numeric standard-handle metadata;
it does not record agent text, arguments or credentials and is removed from the agent environment.
Tracing records the explicit inbox module load, command resolution and compilation separately.
Tracing is off by default. Windows request and connection-probe fixtures enable it to distinguish
command resolution, compilation, process startup and ACP transport delays. The Windows connection-probe
fixture prints its result, supervisor trace and synthetic ACP receipt before temporary-directory cleanup.
The Windows cold connection probe first asserts the default untraced startup path, then runs a separate
traced case. Both retain the production connection-probe deadline.
The agent uses its own default model; Jev does not select or change that agent's model settings.

**API connection (advanced)** retains the compatible endpoint, model name and optional key option.
Configure endpoint and model together. The endpoint must use HTTPS or loopback HTTP and must not
contain URL credentials, a query or fragment. Local-agent and API helper configurations are mutually exclusive.

PNG/JPEG input is enabled when connecting Jev, without a separate image permission. The composer
accepts at most four images within a combined 512 KiB base64 envelope (up to approximately 384 KiB
of image files). It rejects WebP/GIF and oversize files before submission, including captured views.
The native controller and host enforce the same limits for sent and queued turns.
**Jev advanced settings** expose the decision budget, confidence threshold and
provider timeout. Connecting starts the bundled ACP adapter
only after these settings pass validation. Existing project, question, Stop and CAD authority
boundaries remain in force.

Use **Test connection** to verify the current settings before sending a CAD request. For Jev,
the test makes one small TypeSafe inference and, when configured, one argument-model JSON request.
It sends no project data or images, creates no CAD session and leaves the current conversation
and connection intact. Provider usage may be billed. A successful test confirms the configured
providers responded; without an argument model, most CAD edits still need that configuration.
For other ACP agents, the test checks process startup and ACP initialization only, and explicitly
does not claim to have verified provider access. Failures identify the stage and an HTTP status
when available, without displaying provider bodies or credentials.

Only the non-secret Jev settings persist as assistant preferences. After a successful connection,
keys stay in host memory for the application session and are reused across projects. A failed connection
keeps both password fields in the form for retry; only an accepted current connection clears them. They do not enter chat, localStorage,
command arguments or files. Leaving a key blank reuses the app-session key or the explicitly
configured app environment key. Connecting with a new key replaces that shared cached key for
future launches and reconnects. Helper keys remain scoped to the exact endpoint; switching an
endpoint never forwards another endpoint's key. Test connection can use cached keys but never replaces them.
Restarting the application requires re-entering keys unless its environment already supplies them. Credentials
are not forwarded to the injected MCP child.

## Source CLI and custom ACP compatibility

The custom-agent route remains available for development. Use the repository's pinned Bun version and install its locked dependencies. Keep credentials in
the local agent process environment; do not put keys in arguments, project files or chat messages.
The desktop process must inherit these variables. Finder launches do not inherit terminal exports;
use your existing local environment/wrapper setup when launching the app from Finder.

| Variable | Meaning |
| --- | --- |
| `TYPESAFE_API_KEY` | Required TypeSafe API key |
| `TYPESAFE_MODEL` | Defaults to pinned `jev-1.14.0` |
| `JEV_ARGUMENTS_AGENT` | JSON ACP launch descriptor, e.g. `{"command":"codex-acp","args":[]}`; mutually exclusive with the API helper |
| `JEV_ARGUMENTS_ENDPOINT` | Full OpenAI-compatible chat-completions endpoint for open arguments |
| `JEV_ARGUMENTS_MODEL` | Model served by that endpoint; required when the endpoint is set |
| `JEV_ARGUMENTS_API_KEY` | Optional helper key; omit for a local endpoint without authentication |
| `JEV_ENABLE_IMAGES` | PNG/JPEG input defaults to `1`; set `0` to disable it for a custom CLI launch |
| `JEV_MIN_CONFIDENCE` | Minimum selected-branch confidence; default `0.5`, range `0`–`1` |
| `JEV_MAX_STEPS` | Legacy setting accepted for compatibility (`1`–`48`); ignored during execution |
| `JEV_TIMEOUT_MS` | Provider and ordinary MCP operation timeout; default `60000`, range `1000`–`120000`. Manual-review calls use the separate horizon below. |

Manual-review calls (CAD/assembly commits, import commits, metadata/library changes, history,
surface textures and lightweighting requests) bypass this short operation budget. Stop, disconnect,
server liveness, authority and proposal expiry still apply. The pinned MCP SDK cannot disable its
request timer, so these calls use the maximum safe platform timer, `2147483647` ms (about 24.8 days),
in both client layers. This practical client ceiling does not extend any server-side review expiry.
Local CAD draft review otherwise remains pending while the browser stays authorized; other review
services retain their advertised limits.
The native desktop host has no default whole-turn ACP deadline, including steering continuations;
Stop still cancels a turn and terminates an unresponsive agent after its separate grace period.

The helper endpoint must use HTTPS or loopback HTTP, without URL credentials, query parameters or
a fragment. For an already configured local compatible model, an endpoint can be
`http://localhost:11434/v1/chat/completions`; model availability is your local setup's responsibility.
The helper receives the selected schema, text goal and observations. Image bytes are not embedded
as text in its request. Jev sees images when enabled; the helper does not independently interpret them.

In native chat, choose **Custom** and enter:

- **Executable:** the absolute path to the pinned `bun` executable.
- **Arguments:** a JSON array containing the absolute source entrypoint, for example
  `["/absolute/path/to/VibeShape/apps/jev-agent/src/index.ts"]`.

Connect in the intended project. The desktop supplies one project-bound stdio MCP server; do not
configure a separate standalone VibeShape server. The agent discovers that server's actual tool
names. API credentials are not forwarded to the MCP child process.

When the attachment advertises `ask_user_question`, Jev can select its structured native question
contract and wait for a validated answer before dependent CAD work. The question bypasses the short
operation/provider timeout; host expiry and Stop still cancel it. Cancellation, expiry or an invalid
answer stops dependent work. Questions are read-only interactions, not approval for a CAD write.
Composing their open text/field arguments can require the configured argument helper.

`bun run agent:jev` starts the same ACP stdio endpoint from a checkout. Its stdout is reserved for
ACP JSON-RPC, so it is intended for an ACP client rather than an interactive terminal conversation.

## Limits and evidence

- One project session and one prompt at a time. Session loading is not advertised. Within that
  process, retained session context preserves requests, accepted answers and active draft identity
  across turns; restarting the process does
  not restore an interrupted draft or replay the previous turn.
- Up to 256 catalog entries, a 128 KiB question catalog, 12 recent observations and a 64 KB text context. Large observations
  are explicitly marked as truncated; earlier routine observations may leave the bounded window.
  Retained session context shares the 64 KB text budget. Oversized accepted-question observations
  use the same marked truncation as recent history; the turn-local replay cache retains the
  validated full reply. If accumulated answers still exceed the available context after history
  trimming, oldest answer observations are omitted and counted in `omittedAnsweredQuestions`.
  Truncated or omitted evidence never establishes missing design details. A large accepted answer
  does not prevent a subsequent short request from running. Requests that cannot fit even after
  answer compaction are rejected before decision execution. Inspect
  the model again when a required identity or parameter is absent.
  The description catalog has a separate 128 KB ceiling, and decision state has a 192 KB ceiling,
  reserving space for the full 64 KB controller context alongside the catalog. History and uncertain outcomes
  remain structured JSON instead of escaped JSON strings. Older observations are dropped first if
  needed, preserving the newest observation and the controller's history.
  Requests with more than 96 KB of state or 192 KB of combined state/questions opt into TypeSafe's
  [long-context mode](https://docs.typesafe.ai/models#long-context). This preserves required evidence;
  the provider documents higher latency and lower accuracy than its default context window. These
  byte ceilings are application limits, not token-count estimates or a context-acceptance guarantee.
- Incoming prompt text is bounded to 48 KB. At most four PNG/JPEG inputs are accepted, with a
  combined 512 KiB base64 budget. Fresh `render_preview` image blocks can join the next Jev request
  when images are enabled. Unsupported images are rejected rather than silently ignored.
- The default confidence threshold is provisional, not calibrated on CAD tasks. It routes uncertain
  selections to the configured argument model, never permission to bypass CAD validation. This
  adds a selection request before ordinary argument completion; provider failures are not retried.
- SDK transport retries are disabled. Provider failures do not produce replacement actions.
- Chat display has its own budget: only the first tool update carries arguments, and only when
  their JSON fits 8 KiB. Larger arguments are omitted, so that call has no argument-derived target
  hints. Result text uses an 8 KiB JSON budget or a marked 1024-character prefix. Full arguments
  still reach the tool; controller observations retain their separate bounds. For the bundled Jev
  controller, each completed tool stage renews the desktop's 2 MiB / 10,000-update display budget.
  A single stage must fit that bound; other ACP agents retain their cumulative turn budget. Long
  Jev turns can finish without exhausting a cumulative display allowance.
- Local regression tests exercise batching, selected arguments, cancellation, ACP updates,
  revision changes and schema rejection with fake providers. No paid API trial, live CAD authoring
  session or performance benchmark is implied by those tests.
- An offline serialization check of the same 159-tool native catalog reduced the empty-history
  selector request from 770,468 to 146,855 bytes by sharing compact descriptions and keeping nested
  schemas out of action selection. This measures request size, not provider latency or accuracy.

## Why this architecture

[Browser Use's `jev-ultrafast`](https://github.com/browser-use/jev-ultrafast) selects an operation
and its observed DOM target together; it uses a small LLM only for text-field content. Its normal
decision loop reads structured DOM state rather than screenshots. Its published performance
comparisons concern a few runs of one browser task and do not establish CAD performance.
[The author-owned Mario controller](https://github.com/fhshaik/typesafe-mario) similarly selects
among seven actions from structured emulator state; code owns timing and execution.

The VibeShape adapter applies that decomposition to its existing tool catalog. Compared with
adapting the Python browser agent, a Bun/TypeScript ACP process reuses the installed protocol SDKs,
project attachment and strict CAD schemas. Compared with adding a second provider to browser chat,
it keeps provider execution outside the browser bundle. The native agent selector exposes its dedicated settings, while the desktop owns executable resolution and connection-only keys.
Its costs are a separate process, helper configuration for open arguments and additional semantic
decisions that still require real CAD evaluation before speed or quality claims.

TypeSafe's current published input price is $0.042 per million tokens, with free output tokens;
this excludes the argument model. Recheck the [model page](https://docs.typesafe.ai/models)
before budgeting. Aliases can move, so the adapter pins its default model.

## Primary references and skills

Verified on 2026-10-20:

- [TypeSafe skill source](https://github.com/typesafe-ai/skills/tree/main/skills/typesafe-ai) and
  [installation guide](https://docs.typesafe.ai/agent-skill). Read it directly or use one installation
  method; avoid duplicate global and project copies. No third-party skill is silently installed.
- [Function calling](https://docs.typesafe.ai/cookbooks/function_calling) and
  [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out): select closed arguments together.
- [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript): `@typesafe-ai/sdk` 0.7.0, MIT;
  [published source](https://github.com/typesafe-ai/typesafe-sdk-js/tree/v0.7.0).
- [Images](https://docs.typesafe.ai/images): experimental, opt-in header
  `TypeSafe-Danger-Zone-Images: true`; PNG/JPEG multipart assets. These contracts may change.
- [Confidence](https://docs.typesafe.ai/confidence): distinct from option probability and task success.
- [VibeShape operator skills](agent-skills.md): loaded through the existing `read_agent_skill`
  tool. Installing the TypeSafe coding skill does not provide VibeShape modeling authority.

Context7 lookup was unavailable because its monthly quota was exhausted; current official docs,
published SDK types and author-owned source were used instead.
