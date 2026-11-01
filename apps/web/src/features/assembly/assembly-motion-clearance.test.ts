import { describe, expect, it } from "bun:test"
import { emptyAssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  assemblyInstanceRecordSchema,
  assemblyJointRecordSchema,
} from "@vibeshape/domain/assembly-mates"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { z } from "zod"
import {
  createMotionClearanceInspector,
  type MotionClearanceCapture,
  type MotionClearanceInput,
  type MotionClearancePorts,
  motionClearanceInputSchema,
} from "./assembly-motion-clearance"

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
    actor: { type: "user", userId: null },
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
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe("bounded read-only sampled motion clearance", () => {
  it("exposes a serializable MCP input contract with optional defaults and a required captured actor", () => {
    const schema = z.toJSONSchema(motionClearanceInputSchema, { io: "input" })
    expect(schema.required).toContain("actor")
    expect(schema.required).toContain("documentId")
    expect(schema.required).toContain("revision")
    expect(schema.required).not.toContain("sampleCount")
    expect(schema.required).not.toContain("budgetMs")
    const { input } = fixture()
    const { sampleCount: _count, ...withoutDefaults } = input
    expect(motionClearanceInputSchema.parse(withoutDefaults)).toMatchObject({
      sampleCount: 13,
      budgetMs: 120000,
    })
  })
  it("solves exact endpoints, retains actual coordinates and pair evidence, uses project tolerance and never mutates capture", async () => {
    const { capture, input } = fixture()
    const before = JSON.stringify(capture)
    const values: number[] = [],
      progress: number[] = []
    const run = createMotionClearanceInspector({
      capture: () => capture,
      preview: async (changes, revision, pairs) => {
        expect(revision).toBe(7)
        expect(pairs).toEqual([{ leftInstanceId: id(2), rightInstanceId: id(3) }])
        const change = changes[0]
        if (change?.kind !== "joint.update" || change.joint.kind !== "prismatic")
          throw new Error("Expected driven translation.")
        values.push(change.joint.value)
        return {
          ok: true,
          inspection: inspection(
            change.joint.value === 0 ? 0 : 2,
            change.joint.value === 0 ? 3 : 0,
          ),
        }
      },
    })
    const result = await run(input, undefined, ({ completed }) => progress.push(completed))
    expect(values).toEqual([-2, 0, 2])
    expect(result).toMatchObject({
      status: "complete",
      minimumGap: 0.35,
      resolution: 2,
      smallest: { value: 0, distance: 0, volume: 3, violatesMinimumGap: true },
      scope: { documentId: id(1), revision: 7, actor: input.actor },
    })
    expect(result.scope?.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.samples[0]?.poseDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(progress).toEqual([0, 1, 2, 3])
    expect(JSON.stringify(capture)).toBe(before)
    const reverse = await run({ ...input, start: 2, end: -2, minimumGap: 0 })
    expect(reverse.samples.map(({ value }) => value)).toEqual([2, 0, -2])
    expect(reverse.smallest?.violatesMinimumGap).toBe(false)
  })
  it("rejects stale identity, missing joints, invalid ranges and resource bounds without posing", async () => {
    const { capture, input } = fixture()
    let called = 0
    const run = createMotionClearanceInspector({
      capture: () => capture,
      preview: async () => {
        called++
        return { ok: true, inspection: inspection() }
      },
    })
    for (const [patch, reason] of [
      [{ revision: 8 }, "stale"],
      [{ documentId: id(9) }, "stale"],
      [{ jointId: id(9) }, "missing-joint"],
      [{ coordinate: "angle" }, "missing-joint"],
      [{ start: 20 }, "invalid-input"],
      [{ end: -2 }, "invalid-input"],
      [{ sampleCount: 65 }, "invalid-input"],
      [{ minimumGap: -1 }, "invalid-input"],
      [{ budgetMs: 120001 }, "invalid-input"],
      [{ pairs: [{ leftInstanceId: id(2), rightInstanceId: id(2) }] }, "invalid-input"],
      [
        {
          pairs: [
            { leftInstanceId: id(2), rightInstanceId: id(3) },
            { leftInstanceId: id(3), rightInstanceId: id(2) },
          ],
        },
        "invalid-input",
      ],
    ] as const)
      expect(
        await run({
          ...input,
          ...patch,
          pairs: "pairs" in patch ? patch.pairs.map((pair) => ({ ...pair })) : input.pairs,
        }),
      ).toMatchObject({
        status: "incomplete",
        reason,
        samples: [],
      })
    expect(called).toBe(0)
  })
  it("reports source changes, project changes and revision changes after a solve without publishing stale evidence", async () => {
    for (const change of ["project", "revision", "source"] as const) {
      const { capture, input } = fixture()
      let current = capture
      const run = createMotionClearanceInspector({
        capture: () => current,
        preview: async () => {
          current =
            change === "project"
              ? { ...capture, documentId: id(9) }
              : change === "revision"
                ? { ...capture, revision: 8 }
                : { ...capture, assembly: { ...capture.assembly, joints: [] } }
          return { ok: true, inspection: inspection() }
        },
      })
      expect(await run(input)).toMatchObject({ status: "incomplete", reason: "stale", samples: [] })
    }
  })
  it("serializes callers, cancels pending work, ignores its late result and releases the lock", async () => {
    const { capture, input } = fixture()
    const started = deferred<void>(),
      pending = deferred<Awaited<ReturnType<MotionClearancePorts["preview"]>>>()
    let calls = 0
    const run = createMotionClearanceInspector({
      capture: () => capture,
      preview: async () => {
        if (++calls === 1) {
          started.resolve()
          return pending.promise
        }
        return { ok: true, inspection: inspection() }
      },
    })
    const abort = new AbortController()
    const first = run(input, abort.signal)
    await started.promise
    expect(await run(input)).toMatchObject({ status: "incomplete", reason: "busy" })
    abort.abort()
    pending.resolve({ ok: true, inspection: inspection() })
    expect(await first).toMatchObject({ status: "incomplete", reason: "cancelled", samples: [] })
    expect((await run(input)).status).toBe("complete")
  })
  it("labels partial success as incomplete on unsupported mesh, missing distance, solve failure and thrown failure", async () => {
    for (const failure of ["mesh", "distance", "solve", "throw"] as const) {
      const { capture, input } = fixture()
      let count = 0
      const run = createMotionClearanceInspector({
        capture: () => capture,
        preview: async () => {
          if (++count === 1) return { ok: true, inspection: inspection() }
          if (failure === "throw") throw new Error("Worker unavailable.")
          if (failure === "solve") return { ok: false }
          const value = inspection()
          const pair = value.interference[0]
          if (!pair) throw new Error("Missing fixture pair.")
          if (failure === "mesh") pair.status = "unsupported-mesh"
          else delete pair.distance
          return { ok: true, inspection: value }
        },
      })
      const result = await run(input)
      expect(result).toMatchObject({
        status: "incomplete",
        reason:
          failure === "mesh"
            ? "unsupported-mesh"
            : failure === "distance"
              ? "missing-evidence"
              : "solve-failed",
      })
      expect(result.samples.map(({ value }) => value)).toEqual([-2])
    }
  })
  it("aborts on elapsed budget and reports truncation instead of passing", async () => {
    const { capture, input } = fixture()
    const run = createMotionClearanceInspector({
      capture: () => capture,
      preview: async (_changes, _revision, _pairs, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        )
        return { ok: true, inspection: inspection() }
      },
    })
    expect(await run({ ...input, budgetMs: 100 })).toMatchObject({
      status: "incomplete",
      reason: "budget",
      samples: [],
    })
  })
  it("rejects oversized all-pairs and pair/sample products before solving", async () => {
    const { capture, input } = fixture()
    const base = capture.assembly.instances[0]
    if (!base) throw new Error("Missing fixture instance.")
    capture.assembly = {
      ...capture.assembly,
      instances: Array.from({ length: 10 }, (_, n) => ({
        ...base,
        id: assemblyInstanceRecordSchema.parse({ ...base, id: id(n + 20) }).id,
      })),
    }
    let calls = 0
    const run = createMotionClearanceInspector({
      capture: () => capture,
      preview: async () => {
        calls++
        return { ok: true, inspection: inspection() }
      },
    })
    expect(await run(input)).toMatchObject({ reason: "budget" })
    const pairs = capture.assembly.instances
      .flatMap((left, index, all) =>
        all
          .slice(index + 1)
          .map((right) => ({ leftInstanceId: left.id, rightInstanceId: right.id })),
      )
      .slice(0, 32)
    expect(await run({ ...input, pairs, sampleCount: 64 })).toMatchObject({ reason: "budget" })
    expect(calls).toBe(0)
  })
})
