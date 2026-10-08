import { beforeEach, expect, it, mock } from "bun:test"
import type { ProjectOperation } from "@vibeshape/automation-api/local-tools"
import { vi } from "../../../../tests/unit/support/bun-test"

const controller = (() => ({ create: vi.fn(), open: vi.fn(), list: vi.fn() }))()
mock.module("../document/document-controller", () => ({
  createAutomationProject: controller.create,
  openAutomationProject: controller.open,
  listLocalProjects: controller.list,
}))

const { localOperationSchema } = await import("@vibeshape/automation-api/local-tools")
const { createProjectToolPort } = await import("./project-tool-port")
const a = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const b = "0195b5ac-b220-7a2c-8c33-67a36a7f6102"
function operation(
  tool: "list_projects" | "create_project" | "open_project",
  args: Record<string, unknown>,
): ProjectOperation {
  const value = localOperationSchema.parse({ tool, arguments: args })
  if (
    value.tool !== "list_projects" &&
    value.tool !== "create_project" &&
    value.tool !== "open_project"
  )
    throw new Error("Unexpected operation")
  return value
}
function setup() {
  const identity = { id: a, name: "A", revision: 4 }
  const allowed = vi.fn(() => true)
  const read = vi.fn((): typeof identity | null => identity)
  const replace = vi.fn(() => true)
  return {
    allowed,
    read,
    replace,
    port: createProjectToolPort({
      isAllowed: allowed,
      readIdentity: read,
      replaceSession: replace,
    }),
  }
}
beforeEach(() => vi.resetAllMocks())

it("does not access storage without the browser project-management grant", async () => {
  const state = setup()
  state.allowed.mockReturnValue(false)
  expect(await state.port.execute(operation("list_projects", {}))).toMatchObject({
    ok: false,
    diagnostic: { code: "project-management-disabled" },
  })
  expect(controller.list).not.toHaveBeenCalled()
})

it("pages exact project IDs and omits thumbnail/private storage data", async () => {
  const state = setup()
  controller.list.mockResolvedValue({
    ok: true,
    projects: [b, a].map((documentId) => ({
      documentId,
      name: documentId === a ? "A" : "B",
      headRevision: 4,
      updatedAt: "2026-10-04T00:00:00.000Z",
      thumbnail: { bytes: new Uint8Array(100) },
    })),
  })
  expect(await state.port.execute(operation("list_projects", { limit: 1 }))).toEqual({
    ok: true,
    value: {
      activeProjectId: a,
      projects: [{ projectId: a, name: "A", revision: 4, updatedAt: "2026-10-04T00:00:00.000Z" }],
      nextCursor: a,
    },
  })
  expect(
    await state.port.execute(operation("list_projects", { cursor: a, limit: 1 })),
  ).toMatchObject({ ok: true, value: { projects: [{ projectId: b }], nextCursor: null } })
})

it("rejects stale source identity before persistence and refreshes a recovered source handle", async () => {
  const state = setup()
  const request = operation("create_project", {
    name: "B",
    expectedProjectId: b,
    expectedRevision: 4,
  })
  expect(await state.port.execute(request)).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-project" },
  })
  expect(controller.create).not.toHaveBeenCalled()
  controller.open.mockImplementation(async () => {
    state.read.mockReturnValue(null)
    return {
      ok: false,
      diagnostic: { code: "close-failed", message: "Close failed", retryable: true },
    }
  })
  expect(
    await state.port.execute(
      operation("open_project", { projectId: b, expectedProjectId: a, expectedRevision: 4 }),
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: "close-failed" } })
  expect(state.replace).toHaveBeenCalledTimes(1)
})

it("does not reveal catalog results or reacquire authority after Stop", async () => {
  const state = setup()
  controller.list.mockImplementation(async () => {
    state.allowed.mockReturnValue(false)
    return { ok: true, projects: [] }
  })
  expect(await state.port.execute(operation("list_projects", {}))).toMatchObject({
    ok: false,
    diagnostic: { code: "request-cancelled" },
  })
  expect(state.replace).not.toHaveBeenCalled()
  state.allowed.mockReturnValue(true)
  controller.create.mockImplementation(async () => {
    state.allowed.mockReturnValue(false)
    return { ok: true, value: { projectId: b, name: "B", revision: 1 } }
  })
  expect(
    await state.port.execute(
      operation("create_project", { name: "B", expectedProjectId: a, expectedRevision: 4 }),
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: "outcome-unknown" } })
  expect(state.replace).not.toHaveBeenCalled()
})
