import { describe, expect, it } from "bun:test"
import { connectMountsFeatureContentParametersSchema } from "./index"

const parameters = {
  points: [
    [0, 0, 0],
    [30, 0, 0],
  ],
  nodeRadius: 4,
  strutRadius: 2,
}

describe("Connect Mounts worker content boundary", () => {
  it("retains the 0.001 mm workspace clearance required by exact shape bounds", () => {
    for (const [x, accepted] of [
      [99_995.999, true],
      [99_995.9991, false],
    ] as const)
      expect(
        connectMountsFeatureContentParametersSchema.safeParse({
          ...parameters,
          points: [
            [0, 0, 0],
            [x, 0, 0],
          ],
        }).success,
      ).toBe(accepted)
  })

  it("accepts model millimetres with the default tree policy", () => {
    expect(connectMountsFeatureContentParametersSchema.parse(parameters)).toEqual<unknown>({
      ...parameters,
      connectionMode: "tree",
    })
    expect(
      connectMountsFeatureContentParametersSchema.safeParse({
        ...parameters,
        points: Array.from({ length: 16 }, (_, i) => [i, 0, 0]),
        connectionMode: "complete",
      }).success,
    ).toBe(true)
  })

  it.each([
    { points: [[0, 0, 0]] },
    { points: Array.from({ length: 17 }, (_, i) => [i, 0, 0]) },
    {
      points: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [0.0005, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [Number.NaN, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [Number.POSITIVE_INFINITY, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [100_001, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [99_997, 0, 0],
      ],
    },
    { nodeRadius: 0 },
    { strutRadius: 0.0005 },
    { strutRadius: 5 },
    { connectionMode: "nearest" },
    { obstacleBodies: [] },
  ])("rejects malformed, unbounded, and unsupported input %j", (invalid) => {
    expect(
      connectMountsFeatureContentParametersSchema.safeParse({ ...parameters, ...invalid }).success,
    ).toBe(false)
  })
})
