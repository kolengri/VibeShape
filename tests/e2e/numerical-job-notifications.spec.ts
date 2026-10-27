import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Page } from "@playwright/test"
import { numericalJobStatusSchema } from "../../packages/automation-api/src/numerical-jobs"
import { quickLightweightingAnalysisSchema } from "../../packages/automation-api/src/quick-lightweighting-tools"
import { expect, test } from "./fixtures"

type NotificationFixture = {
  read: () => {
    prompts: { text: string }[]
    tools: string[]
    statusReads: number
    busy: boolean
    jobs: unknown[]
    revision: number
    features: { id: string; label: string }[]
  }
  notify: () => void
  dispose: () => void
}
type WorkerGate = {
  state: () => { pending: number; successfulResults: number; terminated: number }
  release: () => number
}

async function holdWorkerCompletion(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker
    const deliveries: (() => void)[] = []
    let releasing = false
    let successfulResults = 0
    let terminated = 0
    class GatedWorker extends NativeWorker {
      private numerical = false
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener("message", (event: MessageEvent) => {
          if (!this.numerical || releasing || event.data?.type !== "complete") return
          event.stopImmediatePropagation()
          if (event.data.response?.ok === true) successfulResults += 1
          deliveries.push(() =>
            this.dispatchEvent(new MessageEvent("message", { data: event.data })),
          )
        })
      }
      postMessage(message: unknown, transferOrOptions?: unknown) {
        this.numerical ||=
          typeof message === "object" &&
          message !== null &&
          "input" in message &&
          "runtimeBaseUrl" in message
        Reflect.apply(NativeWorker.prototype.postMessage, this, [message, transferOrOptions])
      }
      terminate() {
        if (this.numerical) terminated += 1
        super.terminate()
      }
    }
    globalThis.Worker = GatedWorker
    Reflect.set(globalThis, "numericalNotificationGate", {
      state: () => ({ pending: deliveries.length, successfulResults, terminated }),
      release() {
        const ready = deliveries.splice(0)
        releasing = true
        try {
          for (const deliver of ready) deliver()
        } finally {
          releasing = false
        }
        return ready.length
      },
    })
  })
}

function readFixture(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(globalThis, "numericalNotificationFixture") as NotificationFixture).read(),
  )
}
function gateState(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(globalThis, "numericalNotificationGate") as WorkerGate).state(),
  )
}
function releaseWorker(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(globalThis, "numericalNotificationGate") as WorkerGate).release(),
  )
}

function storedAssetCount(page: Page) {
  return page.evaluate(
    async (path) => {
      const { VibeShapeDatabase } = await import(path)
      const database = new VibeShapeDatabase("vibeshape-product-v0")
      try {
        return (await database.assetBlobs.count()) as number
      } finally {
        database.close()
      }
    },
    `/@fs${resolve("packages/persistence/src/database.ts")}`,
  )
}

async function mountChat(page: Page, generation: boolean) {
  await page.evaluate(
    async ({ domainPath, providerPath, generation }) => {
      const moduleUrl = (path: string) => {
        const loaded = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .reverse()
          .find((url) => new URL(url).pathname === path)
        if (!loaded) throw new Error(`Expected loaded browser module ${path}.`)
        return loaded
      }
      const app = await import(moduleUrl("/src/document/document-controller.ts"))
      const domain = await import(domainPath)
      const paths = {
        executor: "/src/automation/local-tool-executor.ts",
        chat: "/src/assistant/native-chat-controller.ts",
        panel: "/src/assistant/assistant-panel.tsx",
        i18n: "/src/i18n/index.ts",
      }
      const { createLocalToolExecutor } = await import(paths.executor)
      const { createNativeChatController } = await import(paths.chat)
      const { AssistantPanel } = await import(paths.panel)
      const { i18n } = await import(paths.i18n)
      const { I18nProvider } = await import(providerPath)
      const { default: React } = await import(moduleUrl("/node_modules/.vite/deps/react.js"))
      const { default: ReactDOM } = await import(
        moduleUrl("/node_modules/.vite/deps/react-dom_client.js")
      )
      const handle = app.createActiveDocumentAutomationSession()
      if (!handle.ok) throw new Error(handle.diagnostic.message)
      const actor = domain.commandActorSchema.parse({
        type: "mcp",
        clientId: "org.vibeshape.numerical-notifications-test",
        sessionId: app.createBrowserDocumentId(),
      })
      if (!handle.enableAutoApply(actor)) throw new Error("The explicit test CAD grant failed.")
      const executor = createLocalToolExecutor(handle, actor)
      const tools: string[] = []
      async function execute(tool: string, arguments_: Record<string, unknown>) {
        tools.push(tool)
        const result = await executor.execute({ tool, arguments: arguments_ })
        if (!result.ok) throw new Error(result.diagnostic.message)
        return result.value
      }
      const draft = await execute("create_draft", { baseRevision: handle.revision })
      const featureId = app.createBrowserFeatureId()
      await execute("create_box", {
        draftId: draft.draftId,
        baseRevision: draft.revision,
        commandId: app.createBrowserDocumentId(),
        featureId,
        label: "Numerical notification source",
        widthMm: 10,
        depthMm: 10,
        heightMm: 10,
      })
      await execute("commit_draft", { draftId: draft.draftId })
      const baseRevision = handle.revision
      const parts = await execute("model_parts", { revision: baseRevision })
      const topology = await execute("model_body_topology", {
        revision: baseRevision,
        featureId,
        outputRole: "result",
        topologyKind: "face",
        limit: 1,
      })
      const source = {
        partId: parts.parts[0].id,
        featureId,
        outputRole: "result",
        contentHash: topology.contentHash,
      }
      let statusReads = 0
      const originalRead = handle.numericalJobs.read.bind(handle.numericalJobs)
      handle.numericalJobs.read = (...args: unknown[]) => {
        statusReads += 1
        return originalRead(...args)
      }
      const prompts: { text: string }[] = []
      const observers = new Set<() => void>()
      let snapshot = {
        projectId: handle.documentId,
        sessionToken: "numerical-notification-test",
        sessionId: "fixture-provider",
        status: "ready",
        canResume: true,
        modes: [],
        models: [],
        configOptions: [],
        authMethods: [],
        currentModeId: null,
        currentModelId: null,
        attachmentCapabilities: { text: true, images: false },
      }
      const response = async () => ({ ok: true, value: snapshot })
      const bridge = {
        protocolVersion: 1,
        connect: response,
        disconnect: response,
        cancel: response,
        setModel: response,
        setMode: response,
        setConfigOption: response,
        authenticate: response,
        respondPermission: response,
        respondQuestion: response,
        onEvent: () => () => {},
        async prompt(input: { text: string }) {
          prompts.push(input)
          if (prompts.length === 1)
            await execute(
              generation ? "request_quick_lightweighting" : "analyze_quick_lightweighting",
              {
                baseRevision,
                source,
                settings: {
                  mode: "preserve-exterior",
                  removalPercent: 20,
                  cellSizeMm: 1,
                  skinThicknessMm: 2,
                },
                ...(generation ? { label: "Cancelled numerical snapshot" } : {}),
              },
            )
          snapshot = { ...snapshot, status: "ready" }
          return response()
        },
      }
      const chat = createNativeChatController({
        projectId: handle.documentId,
        bridge,
        storage: { getItem: () => null, setItem() {}, removeItem() {} },
        automation: {
          getSnapshot: () => ({ connected: true, recovering: false, error: false }),
          subscribe: () => () => {},
          retryRecovery: async () => true,
          ensureConnected: async () => true,
          getNumericalJobs: () => handle.numericalJobs.getSnapshot(actor),
          subscribeNumericalJobs(listener: () => void) {
            observers.add(listener)
            const release = handle.numericalJobs.subscribe(listener)
            return () => {
              observers.delete(listener)
              release()
            }
          },
          cancelNumericalJobs: handle.numericalJobs.cancel,
        },
      })
      chat.start()
      await chat.connect({ command: "fixture-acp", args: [] })
      const document = Reflect.get(globalThis, "document")
      const element = document.createElement("div")
      element.style.cssText =
        "position:fixed;inset:70px 10px 20px auto;width:420px;display:flex;z-index:100"
      document.body.append(element)
      const root = ReactDOM.createRoot(element)
      function Chat() {
        const state = React.useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot)
        return React.createElement(
          I18nProvider,
          { i18n, initialLocale: "en" },
          React.createElement(AssistantPanel, {
            open: true,
            messages: state.messages,
            numericalJobs: state.numericalJobs,
            busy: state.busy,
            canSend: true,
            configuration: null,
            configurationRequired: false,
            error: null,
            storageFailed: false,
            onClose() {},
            onReset: chat.reset,
            onSend: chat.send,
            onQueue: chat.enqueue,
            onCancel: chat.cancel,
          }),
        )
      }
      root.render(React.createElement(Chat))
      Reflect.set(globalThis, "numericalNotificationFixture", {
        read() {
          const report = app.getDocumentControllerState().report
          return {
            prompts,
            tools,
            statusReads,
            busy: chat.getSnapshot().busy,
            jobs: chat.getSnapshot().numericalJobs,
            revision: report.snapshot.revision,
            features: report.snapshot.features.map(
              ({ id, label }: { id: string; label: string }) => ({ id, label }),
            ),
          }
        },
        notify: () => {
          for (const listener of observers) listener()
        },
        dispose() {
          chat.dispose()
          handle.dispose()
          root.unmount()
          element.remove()
        },
      })
    },
    {
      domainPath: `/@fs${resolve("packages/domain/src/index.ts")}`,
      providerPath: `/@fs${resolve("packages/i18n/src/provider.tsx")}`,
      generation,
    },
  )
  const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
  await chat.getByRole("textbox", { name: "Message", exact: true }).fill("Compute this part")
  await chat.getByRole("button", { name: "Send", exact: true }).click()
  await expect(
    chat.getByText(generation ? "Quick generation — Running" : "Quick analysis — Running", {
      exact: true,
    }),
  ).toBeVisible()
  await expect.poll(async () => (await readFixture(page)).busy).toBe(false)
  await expect(chat.getByText("Thinking", { exact: true })).toHaveCount(0)
  await expect(chat.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await expect(chat.getByText(/The assistant will be notified automatically/)).toBeVisible()
  await expect.poll(async () => (await gateState(page)).pending, { timeout: 120_000 }).toBe(1)
  expect((await gateState(page)).successfulResults).toBe(1)
  expect((await readFixture(page)).prompts).toHaveLength(1)
  return chat
}

async function saveEvidence(name: string, evidence: unknown) {
  const directory = resolve("artifacts/numerical-job-notifications")
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
}

test("shows background computation after the ACP turn and continues once with the actual worker result without polling", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await holdWorkerCompletion(page)
  await page.goto("/")
  const chat = await mountChat(page, false)
  expect(await releaseWorker(page)).toBe(1)
  await expect.poll(async () => (await readFixture(page)).prompts.length).toBe(2)
  await expect(chat.getByText("Quick analysis — Completed", { exact: true })).toBeVisible()
  const evidence = await readFixture(page)
  const completed = numericalJobStatusSchema.parse(evidence.jobs[0])
  expect(completed.status).toBe("completed")
  if (completed.status !== "completed" || !completed.result.ok)
    throw new Error("Expected a successful actual Quick worker result.")
  const analysis = quickLightweightingAnalysisSchema.parse(completed.result.value)
  expect(analysis.summary).toMatchObject({ sourceVolumeMm3: 1000 })
  expect(analysis.summary.resultVolumeMm3).toBeLessThan(1000)
  expect(evidence.prompts[1]?.text).toContain(JSON.stringify(completed))
  expect(evidence.statusReads).toBe(0)
  expect(evidence.tools.filter((tool) => tool === "analyze_quick_lightweighting")).toHaveLength(1)
  expect(evidence.tools).not.toContain("get_numerical_job")
  // A duplicate registry delivery must not create another continuation.
  await page.evaluate(() =>
    (Reflect.get(globalThis, "numericalNotificationFixture") as NotificationFixture).notify(),
  )
  expect((await readFixture(page)).prompts).toHaveLength(2)
  await saveEvidence("completion", { ...evidence, worker: await gateState(page) })
})

test("Stop prevents automatic continuation and persistence of a held real generation result", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await holdWorkerCompletion(page)
  await page.goto("/")
  const chat = await mountChat(page, true)
  const initial = await readFixture(page)
  const initialAssets = await storedAssetCount(page)
  expect(initialAssets).toBe(0)
  await chat.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(chat.getByText("Quick generation — Cancelled", { exact: true })).toBeVisible()
  await expect.poll(async () => (await gateState(page)).terminated).toBe(1)
  expect(await releaseWorker(page)).toBe(1)
  const evidence = await readFixture(page)
  expect(evidence.prompts).toHaveLength(1)
  expect(evidence.statusReads).toBe(0)
  expect(evidence.revision).toBe(initial.revision)
  expect(evidence.features).toEqual(initial.features)
  const finalAssets = await storedAssetCount(page)
  expect(finalAssets).toBe(initialAssets)
  const worker = await gateState(page)
  await expect(page.getByRole("region", { name: "Review AI import", exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  await expect(
    page.getByRole("treeitem", { name: "Numerical notification source", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("treeitem", { name: "Cancelled numerical snapshot", exact: true }),
  ).toHaveCount(0)
  const reopenedAssets = await storedAssetCount(page)
  expect(reopenedAssets).toBe(initialAssets)
  await saveEvidence("stop", { ...evidence, worker, initialAssets, finalAssets, reopenedAssets })
})
