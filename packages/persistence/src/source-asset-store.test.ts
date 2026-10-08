import { describe, expect, it } from "bun:test"
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
})
