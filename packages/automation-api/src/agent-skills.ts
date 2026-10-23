import { z } from "zod"
import bundle from "./generated/agent-skills.json" with { type: "json" }
import { localFailure, localFailureSchema } from "./local-tools"

export const assistantTaskContinuityInstructions =
  "Treat successive user messages as additions or corrections to the ongoing task. Keep every unresolved request in session context; a later message replaces earlier work only when the user explicitly cancels or supersedes it. Reconcile steering with active work and resume unfinished requests after an interruption. Save small validated modeling milestones through preview_draft and commit_draft as soon as they are usable, before lengthy inspection or rendering and before starting another independent part. Aim to save within eight successful modeling commands; finish or repair an incomplete coherent stage rather than committing invalid geometry. A preview is not saved work: confirm the successful commit and its actual revision before continuing. After an uncertain write, inspect the saved revision and affected identities instead of repeating it. Complete an in-project modeling task in the original project's editable History. Before reporting it saved, read model_info and the relevant saved model or assembly records; verify the document ID, saved revision and requested changes against the intended project. A .vshape backup, export descriptor, file path, download link, file size or SHA-256 does not prove that the requested changes are saved in that project. Prepare and deliver a backup or geometry export only when the user requests one; an ordinary request to save the model means commit it in the current project. If saving or verifying the target project is blocked, report the blocker and preserved state rather than substituting a file handoff. Before reporting completion, check all pending requests against actual tool results and state any blocked item explicitly."

const indexUri = "vibeshape://agent-skills"
export const agentSkillInstructions =
  "Read vibeshape://agent-skills for the VibeShape operator skill index, then read vibeshape-use and only the workflows/references needed for this task. If your client only exposes tools, call read_agent_skill with no arguments for the index, then with the listed uri for each document. These are instructions, not installed files or permission grants."

const index = {
  schemaVersion: bundle.schemaVersion,
  entrypoint: `${indexUri}/vibeshape-use/SKILL.md`,
  instructions: agentSkillInstructions,
  skills: bundle.skills,
}
const documents = new Map(
  bundle.documents.map((document) => [
    `${indexUri}/${document.path}`,
    { uri: `${indexUri}/${document.path}`, mimeType: "text/markdown", text: document.text },
  ]),
)
documents.set(indexUri, {
  uri: indexUri,
  mimeType: "application/json",
  text: JSON.stringify(index),
})

export const agentSkillResources = Array.from(documents.values(), ({ uri, mimeType }) => ({
  uri,
  mimeType,
  name: uri === indexUri ? "agent-skills" : uri.slice(indexUri.length + 1),
  description:
    uri === indexUri
      ? "VibeShape operator skill index, entrypoint, task descriptions and reference URIs. No document data or credentials."
      : "Bundled VibeShape operator instructions. Follow MCP resource links for related workflows and references.",
}))

export function readAgentSkillResource(uri: string) {
  const content = documents.get(uri)
  return content ? { contents: [content] } : undefined
}

const input = z.object({ uri: z.string().min(1).max(256).default(indexUri) }).strict()
const output = z.object({
  result: z.discriminatedUnion("ok", [
    z
      .object({
        ok: z.literal(true),
        value: z.object({ uri: z.string(), mimeType: z.string(), text: z.string() }).strict(),
      })
      .strict(),
    localFailureSchema,
  ]),
})

export const agentSkillTool = {
  name: "read_agent_skill",
  description:
    "Read the bundled VibeShape operator skill index (no arguments) or a document at an exact uri from that index or its links. Covers modeling, inspection, organization, export and session recovery. Read-only server instructions; no browser command, document access or skill installation.",
  inputSchema: z.toJSONSchema(input),
  outputSchema: z.toJSONSchema(output),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}

export function callAgentSkillTool(arguments_: unknown) {
  const parsed = input.safeParse(arguments_)
  const content = parsed.success ? documents.get(parsed.data.uri) : undefined
  const result = content
    ? ({ ok: true, value: content } as const)
    : localFailure(
        parsed.success ? "unknown-skill-resource" : "invalid-operation",
        parsed.success
          ? "The skill resource is not in the bundled catalog."
          : "The skill URI is invalid.",
      )
  return {
    isError: !result.ok,
    content: [
      { type: "text" as const, text: result.ok ? result.value.text : result.diagnostic.message },
    ],
    structuredContent: { result },
  }
}
