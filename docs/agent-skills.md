# Skills for agents using VibeShape

This pack teaches an external agent to operate VibeShape as a CAD application through its paired MCP session and ordinary browser UI. Both servers bundle it and advertise it in their MCP initialization instructions. It is separate from the repository's engineering skills, which teach agents to develop VibeShape. Loading or installing skills does not configure MCP, authorize a browser tab, or grant auto-apply.

## Load through MCP

No checkout or local skill installation is needed for a connected client:

1. Read `vibeshape://agent-skills` through MCP resources/read. Its JSON index contains the entrypoint, skill descriptions, document URIs, and conditional references.
2. Read the `vibeshape-use` entrypoint and only the task workflows/references needed. Cross-document Markdown links in served documents use exact MCP catalog URIs. The server returns whole documents, so cross-document heading fragments are omitted in the bundle and retained in the source Markdown.
3. For clients that expose only tools to the model, call `read_agent_skill` with `{}` for the index, then `{ "uri": "<listed document URI>" }`. The same content is available through both interfaces.

Local skill reads work before document pairing. Remote reads require the existing OAuth scope and live approved browser tab, like every request to `/mcp`. They never dispatch browser work or consume a CAD draft operation. The remote server still omits local session/authoring-guide resources and binary exports.

The server tells the agent to read the index; the client must expose resources or the fallback tool, and the agent must follow that instruction. This is runtime instruction loading, not silent installation into the client's filesystem.

## Included skills

| Skill | Use |
| --- | --- |
| [vibeshape-use](../.agents/skills/vibeshape-use/SKILL.md) | Entry point, local/remote pairing, capability discovery, recovery, shared draft/revision/units contract |
| [vibeshape-modeling](../.agents/skills/vibeshape-modeling/SKILL.md) | Parametric authoring and conditional guidance for mechanical design and 3D printing |
| [vibeshape-inspection](../.agents/skills/vibeshape-inspection/SKILL.md) | Exact measurements, authored intent, body roles, selectable edges, failure diagnosis |
| [vibeshape-organization](../.agents/skills/vibeshape-organization/SKILL.md) | Part names/visibility and canonical History folders through manual metadata review |
| [vibeshape-export](../.agents/skills/vibeshape-export/SKILL.md) | Native editable backup, STEP/STL/3MF delivery, print-preparation copy, slicer handoff |

Each folder contains a `SKILL.md`, Codex UI metadata, and references only where needed. Install all five sibling folders together: their relative links form one portable pack. Runtime instructions need no repository checkout, developer dependencies, global engineering skills, or source-code edits. Existing server/client dependencies still apply.

The modeling entrypoint separates common CAD intent from [mechanical design](../.agents/skills/vibeshape-modeling/references/mechanical-design.md) and [3D-printing design](../.agents/skills/vibeshape-modeling/references/3d-printing.md). Load the applicable categories together for a printed functional part. Printing guidance distinguishes FDM/FFF from resin and other processes; it does not alter visualization or exact-reconstruction geometry by default.

For FDM/FFF insert lids and covers, [lid fits and compliant retention](../.agents/skills/vibeshape-modeling/references/lid-fits.md)
provides self-contained instructions for corner clearance relief, integral corner
flexure tabs, and distributed cantilever grip fins. It covers strategy selection,
editable geometry, and a minimum/maximum opening travel budget. It distinguishes
existing MCP features from sketch-driven construction and requires physical
calibration before claiming a verified compliant fit.

## Optional local installation

The built-in native [Jev ACP controller](jev-agent.md) reads this existing operator pack
through its injected MCP connection. Its TypeSafe coding skill supplies API implementation guidance;
it does not replace these modeling workflows or grant CAD authority.

In a checkout of this repository, the skills already live under `.agents/skills`. For another Codex project, copy just the five application-use folders into that project's `.agents/skills`. For personal Codex use, copy them into the active Codex home's `skills` directory (normally `~/.codex/skills`). Inspect same-name destinations first; do not overwrite a different pack or unrelated skill. For a clean destination, from the VibeShape repository root:

```sh
skill_destination="/absolute/path/to/consumer-project/.agents/skills"
mkdir -p "$skill_destination"
for skill in vibeshape-use vibeshape-modeling vibeshape-inspection vibeshape-organization vibeshape-export; do
  cp -R ".agents/skills/$skill" "$skill_destination/"
done
```

Use the client's skill discovery/reload mechanism after copying. Other clients can install the same sibling directories in their documented skill location, or load `vibeshape-use/SKILL.md` and follow its relative references as agent instructions. `agents/openai.yaml` is optional for those clients. Do not claim installation in a client until it actually discovers the skill.

Suggested first instruction:

```text
Use $vibeshape-use to work in my VibeShape project. Discover the actual MCP tools,
verify the paired document, and load only the workflow skills needed for my task.
Preserve existing model intent and use the ordinary browser review path.
```

## Connect separately

- **Desktop:** use the app's copied configuration from Settings > Connections. Its authenticated external client automatically receives current-project access, with manual Apply by default. Stop persists until the person chooses Restart local MCP there. See [desktop AI connections](desktop-macos.md#ai-connections).
- **Standalone local/development:** follow the [local MCP quickstart](mcp-quickstart.md). Read the advertised session/authoring-guide resources, open the returned editor URL, and have the owner enable the AI session.
- **Remote:** follow [remote MCP operation](remote-mcp.md) and the deployed endpoint shown in the editor FAQ. Complete OAuth/PKCE and approval in the exact target tab. Remote exposes the bundled skill resources and shared modeling tools, and omits MCP binary export; files use the visible editor's export controls.

After tool discovery and pairing, use one safe `model_info` invocation to establish current access. A configuration file or OAuth success alone is not this evidence. Live server schemas are authoritative; supported operations can change without a skill update.

## Acceptance and maintenance

The pack distinguishes private draft, exact preview, committed browser save, exported geometry, editable backup, slicer open, and physical print. Follow the [model-write approval policy](../.agents/skills/vibeshape-use/references/session.md#model-write-approval): external clients default to manual Apply and may have a separate CAD auto-apply grant, while built-in chat uses connected-assistant authority for its current project. Library publication remains separately reviewed. Lost or uncertain write outcomes require reading saved state before retrying.

When the MCP vocabulary or authority changes, update the relevant pack contract alongside the canonical [automation documentation](architecture/automation-and-mcp.md), local authoring guide, or remote operation guide. The five folders under `.agents/skills` remain the source of truth. Run `bun run skills:bundle` after editing their Markdown; it rewrites relative document links to MCP URIs and generates the JSON included by both server bundles. `bun run skills:validate` checks metadata, bundle freshness, and local file/Markdown anchor targets in every repository skill and reference, including developer skills outside the portable pack. Link parsing uses the pinned Bun Markdown parser, jsdom and github-slugger for GitHub-compatible heading anchors; fenced and inline code examples are ignored and external URLs are not fetched. Check relative links after moving/copying the portable pack. Static validation does not prove a live client connection or a successful modeling task.

For developers, [MCP operator synchronization](../.agents/skills/vibeshape-documentation-sync/SKILL.md#synchronize-mcp-operator-skills) owns this update as part of the same feature task. Feature-boundary planning includes the affected operator workflow, and verification checks its semantic coverage separately from generated-data freshness. This also applies when an existing MCP tool's behavior changes without a new tool name.
