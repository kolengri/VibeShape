import { describe, expect, it } from "bun:test"
import { emitDesignRecipeTypeScript } from "@vibeshape/application/design-recipes"
import { createLengthQuantity, sphereFeatureType } from "@vibeshape/domain"
import { designScriptExample } from "./script-example"
import { executeDesignScript } from "./script-sandbox"

const empty = {
  format: "vibeshape.recipe",
  version: 1,
  name: "Script",
  displayUnits: { length: "mm", angle: "deg" },
  variables: [],
  sketches: [],
  features: [],
  history: [],
} as const
const id = "0195b5ac-b250-7a2c-8c33-000000000100"

describe("isolated design TypeScript execution", () => {
  it("runs the shipped loop example as three validated independent features", async () => {
    const result = await executeDesignScript(designScriptExample)
    expect(result.features).toHaveLength(3)
    expect(result.history).toHaveLength(3)
    expect(result.features[2]?.parameters.origin).toMatchObject({
      x: { value: 30 },
      z: { value: 3 },
    })
  })
  it("executes typed loops and Math and round-trips its exported source", async () => {
    const source = `const recipe = ${JSON.stringify(empty)};
      const radii: number[] = [];
      for (let i: number = 1; i <= 3; i++) radii.push(Math.sqrt(i * i));
      recipe.name = radii.join(",");
      recipe.features.push(${JSON.stringify({ schemaVersion: 1, id, type: sphereFeatureType.type, parameters: { radius: createLengthQuantity(3) }, dependencies: [], references: [], semanticInputs: [], suppressed: false })});
      recipe.history.push({ kind: "feature", id: "${id}" });
      export default recipe;`
    const result = await executeDesignScript(source)
    expect(result.name).toBe("1,2,3")
    expect(result.features[0]?.parameters.radius).toEqual(createLengthQuantity(3))
    expect(await executeDesignScript(emitDesignRecipeTypeScript(result))).toEqual(result)
  })

  it("exposes no browser, host process, network, storage, clock, or random access", async () => {
    const code = `const names = [typeof window, typeof document, typeof fetch, typeof indexedDB, typeof localStorage, typeof process, typeof require, typeof Date];
      if (names.some((name) => name !== "undefined")) throw new Error(names.join(","));
      export default ${JSON.stringify(empty)};`
    expect((await executeDesignScript(code)).name).toBe("Script")
    await expect(
      executeDesignScript(`Math.random(); export default ${JSON.stringify(empty)}`),
    ).rejects.toThrow("Randomness")
    await expect(
      executeDesignScript('import data from "https://example.com/private"; export default data;'),
    ).rejects.toThrow()
  })

  it("interrupts loops, limits memory, and rejects invalid or missing output", async () => {
    await expect(executeDesignScript("while (true) {}", 20)).rejects.toThrow("interrupted")
    await expect(
      executeDesignScript('const list = []; while (true) list.push("x".repeat(100000));', 100),
    ).rejects.toThrow()
    await expect(executeDesignScript("export default { features: [] }")).rejects.toThrow()
    await expect(executeDesignScript("const x: number = 1")).rejects.toThrow()
  })
})
