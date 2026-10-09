import { resolve } from "node:path"
import type { SourceFile } from "typescript/unstable/ast"
import { API } from "typescript/unstable/async"
import { createVirtualFileSystem } from "typescript/unstable/fs"
import type { treeInputs } from "./unit-test-files"

type Input = Awaited<ReturnType<typeof treeInputs>>[number]

/** TypeScript 7 exposes parsing through its native API, rather than its version-only root export. */
export async function unitTestParser(root: string, inputs: Input[]) {
  const contents = Object.fromEntries(
    inputs
      .filter((input) => input.source !== undefined)
      .map((input) => [input.sourcePath ?? resolve(root, input.path), input.source ?? ""]),
  )
  const config = resolve(root, ".unit-test-cache-parser.json")
  const files = Object.keys(contents)
  contents[config] = JSON.stringify({
    compilerOptions: {
      noResolve: true,
      noLib: true,
      allowJs: true,
      jsx: "react-jsx",
      target: "esnext",
    },
    files,
  })
  const api = new API({ cwd: root, fs: createVirtualFileSystem(contents) })
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [config] })
    const program = snapshot.getProject(config)?.program
    if (!program)
      throw new Error("The unit-cache parser did not create its isolated source program.")
    const parsed = new Map<string, Promise<SourceFile | undefined>>()
    const parse = async (input: Input) => {
      const path = input.sourcePath ?? resolve(root, input.path)
      if (!parsed.has(path))
        parsed.set(
          path,
          (async () => {
            if ((await program.getSyntacticDiagnostics(path)).length) return undefined
            return program.getSourceFile(path)
          })(),
        )
      return parsed.get(path)
    }
    return { parse, close: () => api.close() }
  } catch (error) {
    await api.close()
    throw error
  }
}
