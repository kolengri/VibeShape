import { expect, it } from "bun:test"
import { emptyAssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  assemblyInstanceRecordSchema,
  assemblyJointRecordSchema,
} from "@vibeshape/domain/assembly-mates"
import type { AssemblyInspection } from "@vibeshape/protocol"
import type {
  MotionClearanceCapture,
  MotionClearanceInput,
} from "../features/assembly/assembly-motion-clearance"
import { createMotionClearanceAutomationSession } from "./motion-clearance-automation-session"

const id = (n: number) => `01950000-0000-7000-8000-${String(n).padStart(12, "0")}`
const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
function fixture() {
  const joint = assemblyJointRecordSchema.parse({
    schemaVersion: 2,
    id: id(4),
    kind: "prismatic",
    parentInstanceId: id(2),
    childInstanceId: id(3),
    parentFrame: pose,
    childFrame: pose,
    axis: [1, 0, 0],
    value: 0,
    limits: { min: -10, max: 10 },
    driven: true,
  })
  const instances = [2, 3].map((n) =>
    assemblyInstanceRecordSchema.parse({
      schemaVersion: 2,
      id: id(n),
      definitionId: id(5),
      name: `Instance ${n}`,
      grounded: true,
      worldFrame: pose,
    }),
  )
  const capture: MotionClearanceCapture = {
    documentId: id(1),
    revision: 7,
    defaultMinimumGap: 0.35,
    assembly: { ...emptyAssemblyAuthority(), instances, joints: [joint] },
  }
  const input: MotionClearanceInput = {
    documentId: id(1),
    revision: 7,
    actor: { type: "mcp", clientId: "org.example.test", sessionId: id(9) },
    jointId: id(4),
    coordinate: "translation",
    start: -2,
    end: 2,
    sampleCount: 3,
  }
  return { capture, input }
}
function inspection(distance = 1, volume = 0): AssemblyInspection {
  return {
    occurrences: [],
    interference: [
      {
        leftInstanceId: id(2),
        rightInstanceId: id(3),
        distance,
        volume,
        solidCount: volume > 0 ? 1 : 0,
        status: volume > 0 ? "interference" : "clear",
      },
    ],
  }
}

function sessionFixture() {
  const f = fixture()
  let capture: MotionClearanceCapture | null = f.capture
  let measure = async () => ({ ok: true as const, inspection: inspection(0.1, 2) })
  const session = createMotionClearanceAutomationSession({
    documentId: f.capture.documentId,
    isActive: () => true,
    capture: () => capture,
    preview: () => measure(),
  })
  const operation = {
    tool: "inspect_motion_clearance" as const,
    arguments: {
      revision: 7,
      jointId: id(4),
      coordinate: "translation",
      start: -2,
      end: 2,
      sampleCount: 3,
      minimumGap: 0.3,
    },
  }
  return {
    ...f,
    session,
    operation,
    replace: (v: typeof capture) => {
      capture = v
    },
    measure: (fn: typeof measure) => {
      measure = fn
    },
  }
}
it("uses bound capture and exact disposable previews, reports sampled minima and positive-volume collisions", async () => {
  const f = sessionFixture()
  const result = await f.session.execute(f.input.actor, f.operation)
  expect(result).toMatchObject({
    ok: true,
    value: {
      status: "complete",
      coverage: "sampled-poses-only",
      minimumGap: 0.3,
      resolution: 2,
      smallest: { distance: 0.1, volume: 2 },
      samples: [
        { value: -2, collisionCount: 1 },
        { value: 0, collisionCount: 1 },
        { value: 2, collisionCount: 1 },
      ],
    },
  })
  expect(
    await f.session.execute({ ...f.input.actor, sessionId: id(99) }, f.operation),
  ).toMatchObject({ ok: false, diagnostic: { code: "clearance-owner-mismatch" } })
})
function interruptInspection(
  mode: string,
  f: ReturnType<typeof sessionFixture>,
  abort: AbortController,
) {
  if (mode === "project") f.replace({ ...f.capture, documentId: id(99) })
  if (mode === "revision") f.replace({ ...f.capture, revision: 8 })
  if (mode === "source")
    f.replace({ ...f.capture, assembly: { ...f.capture.assembly, joints: [] } })
  if (mode === "tolerance") f.replace({ ...f.capture, defaultMinimumGap: 0.4 })
  if (mode === "stop") f.session.cancel()
  if (mode === "disconnect") f.session.dispose()
  if (mode === "abort") abort.abort()
}
it.each(["project", "revision", "source", "tolerance", "stop", "disconnect", "abort"] as const)(
  "rejects %s changes after await",
  async (mode) => {
    const f = sessionFixture()
    let release!: () => void
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    f.measure(async () => {
      enter()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { ok: true, inspection: inspection() }
    })
    const abort = new AbortController(),
      pending = f.session.execute(f.input.actor, f.operation, abort.signal)
    // Source hashing precedes the first exact query.
    await entered
    expect(release).toBeDefined()
    interruptInspection(mode, f, abort)
    release()
    const result = await pending
    if (result.ok)
      expect(result.value).toMatchObject({
        status: "incomplete",
        reason: "stale",
        samples: [],
        smallest: null,
      })
    else expect(result.diagnostic.code).toBe("session-revoked")
  },
)
it("does not report a pass for unavailable exact distance evidence", async () => {
  const f = sessionFixture()
  f.measure(async () => {
    const value = inspection()
    for (const pair of value.interference) delete pair.distance
    return { ok: true, inspection: value }
  })
  expect(await f.session.execute(f.input.actor, f.operation)).toMatchObject({
    ok: true,
    value: { status: "incomplete", reason: "missing-evidence", samples: [], smallest: null },
  })
})

it("preserves omitted minimumGap and resolves the bound authored print-fit tolerance", async () => {
  const f = sessionFixture()
  const { minimumGap: _minimumGap, ...args } = f.operation.arguments
  f.measure(async () => ({ ok: true, inspection: inspection(0.32, 0) }))
  const result = await f.session.execute(f.input.actor, { ...f.operation, arguments: args })
  expect(result).toMatchObject({
    ok: true,
    value: {
      status: "complete",
      minimumGap: 0.35,
      smallest: { distance: 0.32, violatesMinimumGap: true },
    },
  })
  const explicit = await f.session.execute(f.input.actor, {
    ...f.operation,
    arguments: { ...args, minimumGap: 0.3 },
  })
  expect(explicit).toMatchObject({
    ok: true,
    value: {
      status: "complete",
      minimumGap: 0.3,
      smallest: { distance: 0.32, violatesMinimumGap: false },
    },
  })
})
