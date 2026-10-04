import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { createLocalRecoveryStore, localRecoveryRecordSchema } from "./local-recovery-store"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "vibeshape-recovery-"))
  directories.push(directory)
  const file = join(directory, "session.json")
  const origin = "http://127.0.0.1:43116"
  const record = localRecoveryRecordSchema.parse({
    schemaVersion: 1,
    origin,
    document: { id: "0195b5ac-b250-7a2c-8c33-000000000001", name: "Bracket", revision: 4 },
    connection: {
      protocolVersion: 1,
      token: "A".repeat(43),
      actor: {
        type: "mcp",
        clientId: "org.vibeshape.mcp.local-client",
        sessionId: "0195b5ac-b250-7a2c-8c33-000000000002",
      },
      client: { name: "Test", version: "1" },
      expiresAt: Date.now() + 3600000,
    },
    previousResume: null,
  })
  return { file, origin, record, store: createLocalRecoveryStore(origin, file) }
}
it("stores bounded recovery credentials privately and clears explicit revocation", () => {
  const { store, file, record } = fixture()
  store.save(record)
  expect(statSync(file).mode & 0o777).toBe(0o600)
  expect(store.load()).toEqual(record)
  store.clear()
  expect(store.load()).toBeNull()
})
it("rejects malformed, oversized, and other-origin state without granting access", () => {
  const { store, file, record } = fixture()
  store.save(record)
  writeFileSync(file, "{broken")
  expect(store.load()).toBeNull()
  writeFileSync(file, " ".repeat(16385))
  expect(store.load()).toBeNull()
  writeFileSync(file, JSON.stringify({ ...record, origin: "http://127.0.0.1:43117" }))
  expect(store.load()).toBeNull()
})
it("durably invalidates authority when directory permissions prevent removing its file", () => {
  const { store, file, record, origin } = fixture()
  store.save(record)
  const directory = dirname(file)
  chmodSync(directory, 0o500)
  try {
    store.clear()
    expect(store.load()).toBeNull()
    expect(createLocalRecoveryStore(origin, file).load()).toBeNull()
  } finally {
    chmodSync(directory, 0o700)
  }
})
it("can remove a read-only credential file when invalidation cannot write it", () => {
  const { store, file, record } = fixture()
  store.save(record)
  chmodSync(file, 0o400)
  store.clear()
  expect(store.load()).toBeNull()
})
it("refuses public credential files and linked destinations without changing their contents", () => {
  const { store, file, record } = fixture()
  store.save(record)
  chmodSync(file, 0o644)
  expect(() => store.load()).toThrow("not private")
  chmodSync(file, 0o600)
  const linked = `${file}.linked`
  linkSync(file, linked)
  expect(() => store.save(record)).toThrow("not private")
  rmSync(linked)
  const before = readFileSync(file, "utf8")
  rmSync(file)
  symlinkSync(linked, file)
  writeFileSync(linked, before, { mode: 0o600 })
  expect(() => store.clear()).toThrow("not private")
  expect(readFileSync(linked, "utf8")).toBe(before)
})
