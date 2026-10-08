import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { unitTestInputs } from "./unit-test-inputs"

const receiptSchema = z
  .object({
    version: z.literal(1),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    workspace: z.string(),
    group: z.enum(["node", "dom"]),
    files: z.array(z.string()).min(1),
    exitCode: z.literal(0),
  })
  .strict()
const envelopeSchema = z.object({ receipt: receiptSchema, checksum: z.string() }).strict()
type Receipt = z.infer<typeof receiptSchema>
type Snapshot = Awaited<ReturnType<typeof unitTestInputs>>
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const receiptHash = (receipt: Receipt) =>
  hash([
    receipt.version,
    receipt.key,
    receipt.workspace,
    receipt.group,
    receipt.files,
    receipt.exitCode,
  ])

/** The directory is suitable for an immutable GitHub Actions archive. */
export class UnitTestCache {
  readonly directory: string
  constructor(root: string) {
    this.directory = join(root, ".turbo/unit-tests/v1")
  }

  receipt(
    snapshot: Snapshot,
    workspace: string,
    group: "node" | "dom",
    files: string[],
  ): Receipt | undefined {
    const scope = snapshot.scopes.get(workspace)
    if (!scope?.cacheable) return undefined
    const ordered = [...files].sort()
    return {
      version: 1,
      workspace,
      group,
      files: ordered,
      exitCode: 0,
      key: hash([scope.hash, workspace, group, ordered]),
    }
  }

  async has(receipt: Receipt) {
    try {
      const parsed = envelopeSchema.safeParse(
        JSON.parse(await readFile(join(this.directory, `${receipt.key}.json`), "utf8")),
      )
      return (
        parsed.success &&
        parsed.data.checksum === receiptHash(parsed.data.receipt) &&
        receiptHash(parsed.data.receipt) === receiptHash(receipt)
      )
    } catch {
      return false
    }
  }

  async save(receipt: Receipt, exitCode: number) {
    if (exitCode !== 0) return
    await mkdir(this.directory, { recursive: true })
    const target = join(this.directory, `${receipt.key}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ receipt, checksum: receiptHash(receipt) }), {
      flag: "wx",
    })
    try {
      // Linking publishes a complete file atomically and never overwrites an existing receipt.
      await link(temporary, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    } finally {
      await unlink(temporary)
    }
  }
}
