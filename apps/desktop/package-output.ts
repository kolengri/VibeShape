import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"

export async function withPackageOutput<T>(
  output: string,
  build: (stage: string) => Promise<T>,
): Promise<T> {
  // An existing output is never owned by this run.
  await mkdir(output)
  let complete = false
  try {
    const stage = await mkdtemp(join(output, ".stage-"))
    const result = await build(stage)
    await rm(stage, { recursive: true, force: true })
    complete = true
    return result
  } finally {
    if (!complete) await rm(output, { recursive: true, force: true })
  }
}
