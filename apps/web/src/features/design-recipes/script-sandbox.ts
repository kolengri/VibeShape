import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync"
import { readDesignRecipe } from "@vibeshape/application/design-recipes"
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core"
import { transform } from "sucrase"

export const SCRIPT_SOURCE_LIMIT = 2 * 1024 * 1024
const SCRIPT_OUTPUT_LIMIT = 2 * 1024 * 1024
let enginePromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined

/** QuickJS receives source only: no host functions, document, network, or storage bindings. */
export async function executeDesignScript(source: string, executionMilliseconds = 1000) {
  if (new TextEncoder().encode(source).length > SCRIPT_SOURCE_LIMIT)
    throw new Error("The script exceeds 2 MiB.")
  const compiled = transform(source, {
    transforms: ["typescript", "imports"],
    filePath: "design.ts",
  }).code
  enginePromise ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
  const engine = await enginePromise
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  const deadline = Date.now() + Math.min(1000, Math.max(1, executionMilliseconds))
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const context = runtime.newContext()
  try {
    const setup = context.evalCode(`
      globalThis.Date = undefined;
      Math.random = () => { throw new Error("Randomness is unavailable in design scripts."); };
      Object.freeze(Math);
    `)
    if (setup.error) {
      setup.error.dispose()
      throw new Error("The script sandbox could not initialize.")
    }
    setup.value.dispose()
    const result = context.evalCode(
      `(function() {
      "use strict";
      const serialize = JSON.stringify;
      const output = (function(exports) { ${compiled}\n; return exports.default; })(Object.create(null));
      return serialize(output);
    })()`,
      "design.ts",
    )
    if (result.error) {
      const detail: unknown = context.dump(result.error)
      result.error.dispose()
      const message =
        typeof detail === "object" &&
        detail !== null &&
        "message" in detail &&
        typeof detail.message === "string"
          ? detail.message
          : "Script execution failed."
      throw new Error(message.slice(0, 512))
    }
    const output = context.getString(result.value)
    result.value.dispose()
    if (new TextEncoder().encode(output).length > SCRIPT_OUTPUT_LIMIT)
      throw new Error("The script result exceeds 2 MiB.")
    const recipe = readDesignRecipe(JSON.parse(output))
    if (!recipe.ok) throw new Error(recipe.message)
    return recipe.recipe
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
