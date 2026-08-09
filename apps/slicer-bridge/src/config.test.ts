import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadBridgeConfiguration, parseBridgeArguments, resolveBridgeConfigPath } from "./config"

describe("slicer bridge configuration", () => {
  it("parses explicit pairing and config options", () => {
    expect(
      parseBridgeArguments([
        "--origin",
        "https://cad.example.test",
        "--config",
        "/tmp/vibeshape-bridge.json",
        "--reset-pairing",
      ]),
    ).toEqual({
      origin: "https://cad.example.test",
      configPath: "/tmp/vibeshape-bridge.json",
      resetPairing: true,
      help: false,
    })
    expect(() => parseBridgeArguments(["--origin"])).toThrow("--origin requires a value.")
    expect(() => parseBridgeArguments(["--unknown"])).toThrow("Unknown slicer bridge option")
  })

  it("resolves platform configuration locations without accepting relative overrides", () => {
    expect(
      resolveBridgeConfigPath({
        requestedPath: null,
        platform: "linux",
        environment: { XDG_CONFIG_HOME: "/tmp/config" },
        home: "/tmp/home",
      }),
    ).toBe("/tmp/config/vibeshape/slicer-bridge.json")
    expect(() => resolveBridgeConfigPath({ requestedPath: "relative.json" })).toThrow(
      "--config must use an absolute path.",
    )
  })

  it("creates, reuses, and explicitly rotates one exact-origin credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vibeshape-bridge-config-"))
    const path = join(directory, "nested", "slicer-bridge.json")
    const first = await loadBridgeConfiguration({
      path,
      origin: "https://cad.example.test",
      resetPairing: false,
      generateToken: () => "a".repeat(43),
    })
    const reused = await loadBridgeConfiguration({
      path,
      origin: null,
      resetPairing: false,
      generateToken: () => "b".repeat(43),
    })
    const rotated = await loadBridgeConfiguration({
      path,
      origin: "https://next.example.test",
      resetPairing: true,
      generateToken: () => "c".repeat(43),
    })

    expect(first.token).toBe("a".repeat(43))
    expect(reused).toEqual(first)
    expect(rotated).toMatchObject({
      origin: "https://next.example.test",
      token: "c".repeat(43),
    })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(rotated)
  })

  it("requires explicit authority to create or replace a pairing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vibeshape-bridge-config-"))
    const path = join(directory, "slicer-bridge.json")
    await expect(
      loadBridgeConfiguration({ path, origin: null, resetPairing: false }),
    ).rejects.toThrow("First start requires --origin")
    await loadBridgeConfiguration({
      path,
      origin: "https://cad.example.test",
      resetPairing: false,
      generateToken: () => "a".repeat(43),
    })
    await expect(
      loadBridgeConfiguration({
        path,
        origin: "https://other.example.test",
        resetPairing: false,
      }),
    ).rejects.toThrow("use --reset-pairing")
  })
})
