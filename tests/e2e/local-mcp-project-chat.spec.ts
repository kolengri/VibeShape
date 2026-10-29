import { expect, type Page, test } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi } from "./application-menu-support"
import { createEditorProject } from "./fixtures"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`

type BrowserStore = { put(value: unknown): unknown; clear(): unknown }
type BrowserTransaction = {
  error: unknown
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  objectStore(name: string): BrowserStore
}
type BrowserGlobal = {
  indexedDB: {
    open(name: string): {
      error: unknown
      onerror: (() => void) | null
      onsuccess: (() => void) | null
      result: {
        close(): void
        transaction(names: string[], mode: "readwrite"): BrowserTransaction
      }
    }
  }
}

async function saveTranscript(
  page: Page,
  projectId: string,
  conversationId: string,
  revision: number,
  messages: { id: string; role: string; text: string }[],
) {
  await page.evaluate(
    async ({ projectId, conversationId, revision, messages }) => {
      await new Promise<void>((resolve, reject) => {
        const opening = (globalThis as unknown as BrowserGlobal).indexedDB.open(
          "vibeshape-assistant-transcripts",
        )
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const transaction = db.transaction(["heads", "entries"], "readwrite")
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => {
            db.close()
            reject(transaction.error)
          }
          transaction.objectStore("heads").put({
            version: 1,
            projectId,
            conversationId,
            revision,
            session: { providerConfiguration: "provider-config-must-stay-private" },
          })
          const entries = transaction.objectStore("entries")
          entries.clear()
          for (const [position, value] of messages.entries())
            entries.put({ version: 1, projectId, id: value.id, position, value })
        }
      })
    },
    { projectId, conversationId, revision, messages },
  )
}

test("reads saved project chat over paired MCP without changing CAD or mixing growing conversations", async ({
  page,
}, testInfo) => {
  const local = await createMcpTestClient(45980 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const read = async (args: Record<string, unknown>) => {
    const result = localToolOutputs.read_project_chat.parse(await call("read_project_chat", args))
    if (!result.ok) throw new Error(result.diagnostic.message)
    return result.value
  }
  try {
    await page.goto(local.origin)
    await createEditorProject(page)
    await enableLocalAi(page)
    const info = localToolOutputs.model_info.parse(await call("model_info", {}))
    if (!info.ok) throw new Error(info.diagnostic.message)
    const projectId = info.value.summary.documentId
    expect((await read({ expectedProjectId: projectId })).messages).toEqual([])

    const text = "voxel 🧱 λ ".repeat(6000)
    const messages = [
      { id: id(1), role: "user", text: "Inspect the FDM failure in this project." },
      { id: id(2), role: "tool", text },
    ]
    await saveTranscript(page, projectId, id(3), 7, messages)
    const first = await read({ expectedProjectId: projectId })
    expect(first).toMatchObject({
      conversationId: id(3),
      transcriptRevision: 7,
      source: "persisted",
    })
    expect(first.nextCursor).not.toBeNull()
    expect(JSON.stringify(first)).not.toContain("provider-config-must-stay-private")

    await saveTranscript(page, projectId, id(3), 8, [
      ...messages,
      { id: id(4), role: "tool", text: "A new read tool message was appended." },
    ])
    const fragments = [...first.messages]
    let cursor = first.nextCursor
    while (cursor) {
      const next = await read({ expectedProjectId: projectId, cursor })
      expect(next.transcriptRevision).toBe(7)
      expect(JSON.stringify(next)).not.toContain("A new read tool message was appended.")
      fragments.push(...next.messages)
      cursor = next.nextCursor
    }
    expect(
      fragments
        .filter((message) => message.id === id(2))
        .map(({ text }) => text)
        .join(""),
    ).toBe(text)

    await saveTranscript(page, projectId, id(5), 9, [
      { id: id(6), role: "user", text: "A different current conversation." },
    ])
    expect(
      await call("read_project_chat", { expectedProjectId: projectId, cursor: first.nextCursor }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-transcript" },
    })
    expect((await read({ expectedProjectId: projectId })).messages[0]?.text).toBe(
      "A different current conversation.",
    )
    expect(await call("read_project_chat", { expectedProjectId: id(99) })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-project" },
    })
    expect(await call("model_info", {})).toMatchObject({
      ok: true,
      value: { summary: { documentId: projectId, revision: info.value.summary.revision } },
    })
  } finally {
    await local.close()
  }
})
