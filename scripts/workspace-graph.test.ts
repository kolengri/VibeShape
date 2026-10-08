import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadWorkspaceGraph } from "./workspace-graph"

const directories: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-workspace-graph-"))
  directories.push(root)
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), JSON.stringify(value))
  }
  await write("package.json", {
    name: "@fixture/root",
    workspaces: { packages: ["packages/*"], catalog: { external: "1.0.0" } },
  })
  return { root, write }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("workspace source dependency graph", () => {
  it("includes cycles and every dependency section while excluding registry-only packages", async () => {
    const { root, write } = await fixture()
    await write("packages/app/package.json", {
      name: "app",
      dependencies: { cycle: "workspace:*", external: "catalog:" },
      devDependencies: { development: "workspace:*" },
      peerDependencies: { peer: "^1.0.0" },
      optionalDependencies: { optional: "workspace:*" },
    })
    await write("packages/cycle/package.json", {
      name: "cycle",
      dependencies: { app: "workspace:*" },
    })
    for (const name of ["development", "peer", "optional", "unrelated"])
      await write(`packages/${name}/package.json`, { name })
    const { workspaces, dependencyClosure } = await loadWorkspaceGraph(root)
    expect([...dependencyClosure("app")].sort()).toEqual([
      "app",
      "cycle",
      "development",
      "optional",
      "peer",
    ])
    expect([...dependencyClosure("unrelated")]).toEqual(["unrelated"])
    expect(workspaces.get("peer")?.directory).toBe("packages/peer")
    expect(() => dependencyClosure("missing")).toThrow("Unknown workspace")
  })

  it("rejects duplicate names, overlapping discovery, and undiscovered workspace references", async () => {
    const { root, write } = await fixture()
    await write("packages/one/package.json", { name: "duplicate" })
    await write("packages/two/package.json", { name: "duplicate" })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("Duplicate workspace name")
    await write("packages/two/package.json", {
      name: "two",
      peerDependencies: { missing: "workspace:*" },
    })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("undiscovered workspace dependencies")
    await write("packages/two/package.json", { name: "two" })
    await write("package.json", { name: "root", workspaces: ["packages/*", "packages/one"] })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("Duplicate workspace name")
  })

  it("rejects malformed dependency fields, reserved commands, and unsafe or empty discovery", async () => {
    const { root, write } = await fixture()
    await write("packages/one/package.json", { name: "one", devDependencies: { external: 7 } })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("Invalid workspace manifest")
    await write("packages/one/package.json", { name: "one", scripts: { transit: "" } })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("reserved command-free cache tasks")
    await write("package.json", { name: "root", workspaces: ["../outside/*"] })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("inside the repository")
    await write("package.json", { name: "root", workspaces: ["missing/*"] })
    await expect(loadWorkspaceGraph(root)).rejects.toThrow("matched no manifests")
  })
})
