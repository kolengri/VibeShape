# Local CAD MVP acceptance

Verified on macOS on 2026-10-02. This delivery keeps the existing exact OCCT/Replicad editor and
SolveSpace sketch solver. It adds external-agent onboarding resources, a reproducible local
build from the verified corresponding-source bundle, and real printing acceptance journeys.
It does not add an embedded chat or an arbitrary-code modeling tool.

## Accepted workflow

A real stdio MCP client creates a constrained mounting plate through typed commands and browser
Apply. The user changes its width from 80 to 90 mm in the editor; a subsequent agent draft changes
hole diameter from 4.4 to 5.4 mm while preserving that width. The journey checks stale-draft
rejection, exact geometry, Undo/Redo, save/reload/re-pair, editable feature expressions and exports.
The final part is 90 × 40 × 4 mm with four through-holes at (8,8), (82,8), (82,32), and (8,32) mm.
Its exact volume is 14033.564632885287 mm³. A second journey executes the JSON operations published
in the actual MCP authoring guide against the real geometry kernel.

## Natural-language agent acceptance

A real Codex CLI client using `gpt-6.1-sol` with high reasoning and the existing ChatGPT login
received a plain-language task to create a 40 × 24 × 4 mm plate with two Ø4 mm through-holes.
It read the MCP guide, confirmed an empty document, created two editable sketches plus Extrude
and Hole, previewed exact geometry, requested commit, and verified committed revision 5 after
normal browser Apply. The result was one valid solid with volume 3739.469035085126 mm³
(`3840 − 32π`) and centres at (8,12) and (32,12) mm. The browser then renamed it to
**Codex mounting plate**, saved as revision 6. This example remains in the default-origin local
browser library. The CLI exited normally afterward, closing its owned server; a new client
starts the server again. Private local evidence is in `.artifacts/agent-acceptance/`.

The initial CLI run with approval policy `never` correctly blocked `commit_draft`. The accepted
run used the CLI's supported automatic approval review, retained the separate browser Apply
gate, and did not change application security settings or bypass a review decision.

## Evidence

- `bun run check`: formatting, lint, workspace types, **253 test files / 2,071 tests**, and build pass.
- Existing MCP browser matrix: **48 cases pass** across Chromium, Firefox and WebKit, including
  invalid geometry/recovery, cancellation, client disconnect, hostile origins, oversized inputs,
  revision/topology conflicts, variable expressions and compact/light/dark UI.
- `bun run test:e2e tests/e2e/local-mcp-printing-journey.spec.ts --workers=3`: **6 cases pass** across
  all three browsers, using the controlled geometry runtime.
- Repository Fallow check and `git diff --check`: pass.
- Independent Astra/high review of the 12 implementation/test/delivery files: no open findings.
  Reviewed source manifest SHA-256:
  `1bb64d578fdd25d8c72b9ca07b958f88b304acbef786ecd007913a72ebe5191b`.
- FreeCAD 1.1.3 independently reads exported STEP as one valid solid, 10 faces, bounds
  `[0,0,0]`–`[90,40,4]`, volume 14033.564632885278 mm³; bounds delta 0 and relative volume error
  6.48e-16 against the independent analytic expectation.
- PrusaSlicer reads STL and 3MF as one manifold part with 2,044 facets and 90 × 40 × 4 mm dimensions.
  Snapmaker Orca also reads the 3MF with the same dimensions and facet count. These are import
  checks, not slicing, material-strength validation or evidence of a physical print.
- The registered Codex MCP command successfully initializes, lists **34 tools**, reads the session
  resource and serves the editor, build provenance and source index with HTTP 200 at the default
  loopback origin. Tool timeout is 420 seconds to cover browser review and geometry execution.

Generated examples and native-reader reports are retained locally in
`.artifacts/printing-journey/{chromium,firefox,webkit}/`. Logs and the installed-config smoke result
are in `.artifacts/delivery-evidence/`. These generated files are ignored by Git; no browser data,
private runtime logs, source archives or credentials are published in the branch.

## Runtime identity

The delivered OCCT revision is `bb368e271e24f63078129283148ce83db6b9670a`.
The prepared build's `/local-build.json` records source archive identities and these WASM hashes:

- OCCT: `7195d6866a895c6648bba4dc04e8b49edb76f52d531b29972343c3c076ff36dd`.
- SolveSpace: `4f11c532844b963910bf9bf5aebabe67aed7926d1307195cc2d4fcc9f06dee82`.

## Access and boundaries

Use the registered `vibeshape` MCP server from a new Codex session or configure another stdio
client as described in [the quickstart](mcp-quickstart.md). The client starts and owns the local
server. Open `http://127.0.0.1:43114`, keep the editor tab open and click **Enable AI session**.
The current running conversation does not automatically acquire a newly registered MCP server.
Only one client owns the default port at a time; ending that client stops its server.
The MCP client can require its own confirmation for `commit_draft` before the browser review
appears. A noninteractive client with approval policy `never` will block that call; use an
interactive client with the normal confirmation flow. Do not disable the browser Apply gate.

Edits are revision-checked and require browser Apply. The bridge exposes named schemas, not shell,
filesystem, network or arbitrary code execution. Existing hostile-origin and resource-bound tests
cover those protocol boundaries; this is not a claim that every possible CAD input is inexpensive.
The MCP subset does not expose every manual editor feature, assemblies or production printability
analysis. At this acceptance date, session Undo/Redo did not survive a process restart; committed
browser-local models did. Durable navigation supersedes that limitation under
[ADR-0125](adr/0125-durable-saved-change-navigation.md); it does not retroactively extend this report's evidence.
Public distribution, an installed/offline update lifecycle and full enterprise CAD parity remain
outside this verified local delivery. See [deployment and rollback](deployment.md).
