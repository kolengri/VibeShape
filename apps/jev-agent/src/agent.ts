import * as acp from "@agentclientprotocol/sdk"
import { assistantToolResultText } from "@vibeshape/automation-api/assistant-tool-targets"
import { z } from "zod"
import type { Configuration } from "./configuration"
import type { CompleteArguments, Decide, Photo } from "./contracts"
import { createController, type ToolEvent } from "./controller"
import { connectMcp } from "./mcp"

const photoSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"]),
  data: z
    .string()
    .min(4)
    .max(512 * 1024)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})
export function promptContent(blocks: acp.ContentBlock[], images: boolean) {
  const text: string[] = []
  const photos: Photo[] = []
  for (const block of blocks) {
    if (block.type === "text") text.push(block.text)
    else if (block.type === "resource" && "text" in block.resource)
      text.push(JSON.stringify({ attachment: block.resource.uri, text: block.resource.text }))
    else if (block.type === "resource_link")
      text.push(JSON.stringify({ resource: block.uri, name: block.name, expanded: false }))
    else if (block.type === "image" && images) photos.push(photoSchema.parse(block))
    else
      throw new Error(
        "This attachment is unsupported. Images require JEV_ENABLE_IMAGES=1 and PNG or JPEG.",
      )
  }
  const goal = text.join("\n")
  if (
    !goal.trim() ||
    Buffer.byteLength(goal) > 48_000 ||
    photos.length > 4 ||
    photos.reduce((sum, photo) => sum + photo.data.length, 0) > 512 * 1024
  )
    throw new Error("The prompt exceeds the Jev text or image budget.")
  return { goal, photos }
}

type Dependencies = {
  decide: Decide
  completeArguments?: CompleteArguments | undefined
  connect?: typeof connectMcp
}
type Session = {
  id: string
  port: Awaited<ReturnType<typeof connectMcp>>
  controller: ReturnType<typeof createController>
  active: AbortController | null
  previous: string[]
}

function toolDisplayText(value: unknown) {
  const text = assistantToolResultText(value)
  if (!text || Buffer.byteLength(JSON.stringify(text)) <= 8192) return text
  // A 1024-character prefix fits even when JSON escapes every character to six bytes.
  return `${text.slice(0, 1024)}\n[Tool result truncated in chat display.]`
}

async function toolUpdate(client: acp.AgentContext, sessionId: string, event: ToolEvent) {
  const rawInput =
    event.status === "in_progress" && Buffer.byteLength(JSON.stringify(event.arguments)) <= 8192
      ? { rawInput: event.arguments }
      : {}
  const text = toolDisplayText(event.result)
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: event.status === "in_progress" ? "tool_call" : "tool_call_update",
      toolCallId: event.id,
      name: event.name,
      title: event.name,
      kind: "other",
      status: event.status,
      ...rawInput,
      ...(text ? { content: [{ type: "content", content: { type: "text", text } }] } : {}),
    },
  })
}

export function createJevAgent(configuration: Configuration, dependencies: Dependencies) {
  let session: Session | null = null
  let opening = false
  let formElicitation = false
  const app = acp
    .agent({ name: "vibeshape-jev" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      formElicitation = Boolean(params.clientCapabilities?.elicitation?.form)
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentInfo: {
          name: "vibeshape-jev",
          version: "0.0.0",
          title: "VibeShape Jev (experimental)",
        },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { embeddedContext: true, image: configuration.images },
        },
        authMethods: [],
      }
    })
    .onRequest(acp.methods.agent.authenticate, () => ({}))
    .onRequest(acp.methods.agent.session.new, async ({ params, client, signal }) => {
      if (session || opening || params.mcpServers.length !== 1)
        throw new Error("Jev requires one new session with one VibeShape stdio MCP server.")
      opening = true
      const id = crypto.randomUUID()
      try {
        const server = params.mcpServers[0]
        if (!server) throw new Error("The VibeShape MCP server is missing.")
        const port = await (dependencies.connect ?? connectMcp)(
          server,
          params.cwd,
          async (request, requestSignal) => {
            if (
              !formElicitation ||
              requestSignal.aborted ||
              ("mode" in request && request.mode === "url")
            )
              return { action: "decline" }
            return client.request(
              acp.methods.client.elicitation.create,
              {
                ...request,
                mode: "form",
                sessionId: id,
              },
              { cancellationSignal: requestSignal },
            )
          },
          configuration.timeoutMs,
        )
        if (signal.aborted) {
          await port.close()
          signal.throwIfAborted()
        }
        session = {
          id,
          port,
          active: null,
          previous: [],
          controller: createController({
            port,
            decide: dependencies.decide,
            completeArguments: dependencies.completeArguments,
            maxSteps: configuration.maxSteps,
            minConfidence: configuration.minConfidence,
            timeoutMs: configuration.timeoutMs,
            images: configuration.images,
          }),
        }
        return { sessionId: id }
      } finally {
        opening = false
      }
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
      const current = session
      if (!current || current.id !== params.sessionId)
        throw new Error("The Jev session is unavailable.")
      if (current.active) throw new Error("A Jev turn is already running.")
      const content = promptContent(params.prompt, configuration.images)
      const pending = new AbortController()
      current.active = pending
      const turnSignal = AbortSignal.any([signal, pending.signal])
      try {
        const goal = current.previous.length
          ? JSON.stringify({ previousRequests: current.previous, currentRequest: content.goal })
          : content.goal
        const message = await current.controller.run(goal, content.photos, turnSignal, (event) =>
          toolUpdate(client, current.id, event),
        )
        current.previous = [...current.previous, content.goal.slice(-4000)].slice(-2)
        await client.notify(acp.methods.client.session.update, {
          sessionId: current.id,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: message },
          },
        })
        return { stopReason: "end_turn" }
      } catch {
        if (turnSignal.aborted) return { stopReason: "cancelled" }
        await client.notify(acp.methods.client.session.update, {
          sessionId: current.id,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "The Jev controller stopped after a provider, connection or argument error. No action was retried. Inspect the last tool result before continuing.",
            },
          },
        })
        return { stopReason: "end_turn" }
      } finally {
        if (current.active === pending) current.active = null
      }
    })
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      if (session?.id === params.sessionId) session.active?.abort()
    })
  return {
    app,
    async close() {
      session?.active?.abort()
      await session?.port.close()
      session = null
    },
  }
}
