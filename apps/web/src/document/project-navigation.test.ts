import { describe, expect, it } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain"
import { createProjectNavigation, projectRecoveryUrl, readProjectUrl } from "./project-navigation"

const first = documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000101")
const second = documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000102")
const third = documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000103")
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function fixture(failWrites = false) {
  let href = `https://cad.test/editor?theme=dark&project=${first}#view`
  let active: string | null = first
  let listener: (() => void) | null = null
  const writes: { href: string; mode: string }[] = []
  const errors: string[] = []
  const opens: string[] = []
  const libraries: AbortSignal[] = []
  let library: NonNullable<Parameters<typeof createProjectNavigation>[0]["library"]> = async () => {
    active = null
    return { ok: true }
  }
  let open: Parameters<typeof createProjectNavigation>[0]["open"] = async (id) => {
    active = id
    navigation.sync(id)
    return { ok: true }
  }
  const navigation = createProjectNavigation({
    href: () => href,
    activeProjectId: () => active,
    write: (next, mode) => {
      if (failWrites) throw new Error("History is unavailable")
      href = next
      writes.push({ href, mode })
    },
    subscribe: (next) => {
      listener = next
      return () => {
        listener = null
      }
    },
    open: (id, signal) => {
      opens.push(id)
      return open(id, signal)
    },
    library: (signal) => {
      libraries.push(signal)
      return library(signal)
    },
    failed: (error) => {
      errors.push(error)
    },
  })
  const stop = navigation.listen()
  return {
    navigation,
    writes,
    errors,
    opens,
    libraries,
    setLibrary: (next: typeof library) => {
      library = next
    },
    stop,
    href: () => href,
    active: () => active,
    setOpen: (next: typeof open) => {
      open = next
    },
    setActive: (id: string) => {
      active = id
    },
    pop: (id: string | null) => {
      const url = new URL(href)
      if (id === null) url.searchParams.delete("project")
      else url.searchParams.set("project", id)
      href = url.href
      listener?.()
    },
  }
}

describe("local project URLs", () => {
  it.each(["success", "failure", "rejection"])(
    "reports pending navigation until %s settles",
    async (outcome) => {
      const f = fixture()
      const states: boolean[] = []
      const unsubscribe = f.navigation.subscribePending(() =>
        states.push(f.navigation.getPendingSnapshot()),
      )
      let finish = () => {}
      f.setOpen(async (id) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        if (outcome === "rejection") throw new Error("Opening failed")
        if (outcome === "failure") return { ok: false, diagnostic: { code: "document-not-found" } }
        f.setActive(id)
        return { ok: true }
      })
      f.pop(second)
      expect(f.navigation.getPendingSnapshot()).toBe(true)
      expect(f.active()).toBe(first)
      await settle()
      expect(f.navigation.getPendingSnapshot()).toBe(true)
      finish()
      await settle()
      expect(f.navigation.getPendingSnapshot()).toBe(false)
      expect(states).toEqual([true, false])
      unsubscribe()
      f.stop()
    },
  )
  it("accepts only one schema-valid ID and provides a recovery URL preserving other state", () => {
    expect(readProjectUrl("https://cad.test/?theme=dark")).toEqual({ kind: "default" })
    for (const query of ["project=", "project=no", `project=${first}&project=${second}`])
      expect(readProjectUrl(`https://cad.test/?${query}`)).toEqual({ kind: "invalid" })
    expect(readProjectUrl(`https://cad.test/?project=${second}`)).toEqual({
      kind: "project",
      documentId: second,
    })
    expect(projectRecoveryUrl(`https://cad.test/editor?theme=dark&project=no#view`)).toBe(
      "https://cad.test/editor?theme=dark#view",
    )
  })

  it("pushes successful selections without replacing unrelated query or fragment state", () => {
    const f = fixture()
    f.navigation.sync(first, "replace")
    expect(f.writes).toHaveLength(0)
    f.navigation.sync(second)
    expect(f.writes).toEqual([
      { href: `https://cad.test/editor?theme=dark&project=${second}#view`, mode: "push" },
    ])
    f.stop()
  })

  it("opens Back/Forward destinations without adding history entries", async () => {
    const f = fixture()
    f.pop(second)
    await settle()
    expect(f.active()).toBe(second)
    f.pop(first)
    await settle()
    expect(f.active()).toBe(first)
    expect(f.opens).toEqual([second, first])
    expect(f.writes).toEqual([])
    f.stop()
  })

  it("uses guarded library navigation for bare Back destinations and keeps Forward deep links", async () => {
    const f = fixture()
    f.pop(null)
    await settle()
    expect(f.active()).toBeNull()
    expect(f.libraries).toHaveLength(1)
    expect(readProjectUrl(f.href())).toEqual({ kind: "default" })
    f.pop(second)
    await settle()
    expect(f.active()).toBe(second)
    expect(f.opens).toEqual([second])
    expect(f.writes).toEqual([])
    expect(f.errors).toEqual([])
    f.stop()
  })
  it("restores the active URL when returning to the library is blocked", async () => {
    const f = fixture()
    f.setLibrary(async () => ({ ok: false, diagnostic: { code: "project-action-blocked" } }))
    f.pop(null)
    await settle()
    expect(f.active()).toBe(first)
    expect(new URL(f.href()).searchParams.get("project")).toBe(first)
    expect(f.errors).toEqual(["project-action-blocked"])
    f.stop()
  })
  it("clears the project URL without losing unrelated URL state and reports write failures", () => {
    const f = fixture()
    expect(f.navigation.clear()).toBe(true)
    expect(f.href()).toBe("https://cad.test/editor?theme=dark#view")
    expect(f.writes).toEqual([{ href: f.href(), mode: "push" }])
    f.stop()
    const failed = fixture(true)
    expect(failed.navigation.clear()).toBe(false)
    expect(failed.errors).toEqual(["project-url-unavailable"])
    failed.stop()
  })

  it("reconciles failed and blocked history navigation to the actual active session", async () => {
    const f = fixture()
    for (const code of ["project-action-blocked", "document-not-found", "persistence-failed"]) {
      f.setOpen(async () => ({ ok: false, diagnostic: { code } }))
      f.pop(second)
      await settle()
      expect(f.active()).toBe(first)
      expect(new URL(f.href()).searchParams.get("project")).toBe(first)
      expect(f.writes.at(-1)?.mode).toBe("replace")
    }
    expect(f.errors).toEqual([
      "project-action-blocked",
      "document-not-found",
      "project-open-failed",
    ])
    f.pop("malformed")
    await settle()
    expect(f.errors.at(-1)).toBe("invalid-project-url")
    expect(f.opens).toHaveLength(3)
    f.stop()
  })

  it("cancels an older pending destination and serializes the newest request", async () => {
    const f = fixture()
    const states: boolean[] = []
    f.navigation.subscribePending(() => states.push(f.navigation.getPendingSnapshot()))
    let finish!: () => void
    let firstSignal: AbortSignal | undefined
    f.setOpen(async (id, signal) => {
      if (id === second) {
        firstSignal = signal
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { ok: false, diagnostic: { code: "cancelled" } }
      }
      f.setActive(id)
      f.navigation.sync(id)
      return { ok: true }
    })
    f.pop(second)
    await settle()
    f.pop(third)
    expect(firstSignal?.aborted).toBe(true)
    expect(f.navigation.getPendingSnapshot()).toBe(true)
    finish()
    await settle()
    expect(f.opens).toEqual([second, third])
    expect(f.active()).toBe(third)
    expect(new URL(f.href()).searchParams.get("project")).toBe(third)
    expect(f.errors).toEqual([])
    expect(f.writes).toEqual([])
    expect(states).toEqual([true, false])
    f.stop()
  })

  it("reports a failed history write without claiming the URL was restored", async () => {
    const f = fixture(true)
    f.setOpen(async () => ({ ok: false, diagnostic: { code: "project-action-blocked" } }))
    f.pop(second)
    await settle()
    expect(f.active()).toBe(first)
    expect(new URL(f.href()).searchParams.get("project")).toBe(second)
    expect(f.errors).toEqual(["project-url-unavailable"])
    f.stop()
  })

  it("removes listeners and cancels pending navigation on owner cleanup", async () => {
    const f = fixture()
    let finish!: () => void
    let signal: AbortSignal | undefined
    f.setOpen(async (_id, received) => {
      signal = received
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { ok: false, diagnostic: { code: "cancelled" } }
    })
    f.pop(second)
    await settle()
    f.stop()
    expect(signal?.aborted).toBe(true)
    expect(f.navigation.getPendingSnapshot()).toBe(false)
    finish()
    await settle()
    f.pop(third)
    await settle()
    expect(f.opens).toEqual([second])
    expect(f.errors).toEqual([])
    expect(f.writes).toEqual([])
  })
})
