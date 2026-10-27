import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { sourceAssetsFixture } from "../../../scripts/source-assets-fixture"
import { prepareSourceAssetBytes } from "./source-asset-store"

describe("prepared immutable source bytes", () => {
  it("copies caller-owned bytes and verifies descriptor digest and length", async () => {
    const { asset, blob } = await sourceAssetsFixture()
    const prepared = await prepareSourceAssetBytes(asset, blob.bytes)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(prepared.diagnostic.message)
    blob.bytes.fill(0)
    expect(prepared.value.bytes).not.toEqual(blob.bytes)
    expect((await prepareSourceAssetBytes(asset, blob.bytes)).ok).toBe(false)
    expect((await prepareSourceAssetBytes(asset, new Uint8Array(1))).ok).toBe(false)
    expect(
      (await prepareSourceAssetBytes({ ...asset, digest: "z".repeat(64) }, prepared.value.bytes))
        .ok,
    ).toBe(false)
  })
  it("prepares a source above the former per-asset and aggregate publication budgets", async () => {
    const { asset } = await sourceAssetsFixture()
    const bytes = new Uint8Array(64 * 1024 * 1024 + 1)
    bytes[bytes.length - 1] = 23
    const digest = createHash("sha256").update(bytes).digest("hex")
    const prepared = await prepareSourceAssetBytes(
      {
        ...asset,
        format: "stl",
        filename: "Candidate.stl",
        representation: "triangle-mesh",
        digest,
        byteLength: bytes.byteLength,
      },
      bytes,
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(prepared.diagnostic.message)
    expect(prepared.value.bytes).not.toBe(bytes)
    expect(prepared.value.digest).toBe(digest)
    expect(prepared.value.bytes.length).toBe(67_108_865)
    expect(prepared.value.bytes.at(-1)).toBe(23)
  })
})
