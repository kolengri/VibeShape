import { randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { access, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { resolveSlicerExecutable, slicerNames } from "@vibeshape/slicer-bridge/native"
import {
  nativeCustomSlicerIdSchema,
  nativeSlicerTargetsSchema,
} from "@vibeshape/slicer-handoff/native"
import { slicerIdSchema } from "@vibeshape/slicer-handoff/protocol"
import { z } from "zod"
import type { NativeSlicerApplication } from "./native-slicer-launcher"

const customApplicationSchema = z.strictObject({
  id: nativeCustomSlicerIdSchema,
  name: z.string().trim().min(1).max(120),
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => isAbsolute(value) && !value.includes("\0")),
  kind: z.enum(["bundle", "executable"]),
})
const registrySchema = z.array(customApplicationSchema).max(16)

async function isExecutable(path: string) {
  try {
    await access(path, constants.X_OK)
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
async function inspectSlicerApplication(path: string) {
  if (!isAbsolute(path)) return null
  const canonical = await realpath(path).catch(() => null)
  if (!canonical) return null
  const metadata = await stat(canonical)
  if (canonical.endsWith(".app") && metadata.isDirectory()) {
    if (!(await stat(join(canonical, "Contents/Info.plist")).catch(() => null))?.isFile())
      return null
    return { path: canonical, kind: "bundle" as const }
  }
  return (await isExecutable(canonical)) ? { path: canonical, kind: "executable" as const } : null
}
function isOwnedRegistryFile(details: Stats) {
  return (
    details.isFile() &&
    details.size <= 65536 &&
    (details.mode & 0o077) === 0 &&
    (!process.getuid || details.uid === process.getuid())
  )
}
async function readRegistry(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null)
  if (!file) return []
  try {
    const details = await file.stat()
    if (!isOwnedRegistryFile(details)) return []
    const buffer = Buffer.alloc(65537)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== details.size || bytesRead > 65536) return []
    return registrySchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")))
  } catch {
    return []
  } finally {
    await file.close()
  }
}
async function writeRegistry(path: string, applications: z.infer<typeof registrySchema>) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(JSON.stringify(registrySchema.parse(applications)))
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
export function createNativeSlicerApplications(options: {
  directory: string
  resolve?: typeof resolveSlicerExecutable
  inspect?: typeof inspectSlicerApplication
  env?: NodeJS.ProcessEnv
}) {
  const registry = join(options.directory, "slicer-applications.json")
  const inspect = options.inspect ?? inspectSlicerApplication
  let current: NativeSlicerApplication[] = []
  async function list() {
    const installed = await Promise.all(
      slicerIdSchema.options.map(async (id) => {
        const executable = await (options.resolve ?? resolveSlicerExecutable)({
          slicerId: id,
          environment: { PATH: (options.env ?? process.env).PATH ?? "" },
          pathIsExecutable: isExecutable,
        })
        if (!executable) return null
        const bundle = dirname(dirname(dirname(executable)))
        const application = await inspect(bundle.endsWith(".app") ? bundle : executable)
        return application ? { ...application, id, name: slicerNames[id] } : null
      }),
    )
    const custom = await Promise.all(
      (await readRegistry(registry)).map(async (saved) => {
        const application = await inspect(saved.path)
        return application && application.path === saved.path && application.kind === saved.kind
          ? saved
          : null
      }),
    )
    current = [...installed, ...custom].filter((application) => application !== null)
    return nativeSlicerTargetsSchema.parse(current.map(({ id, name }) => ({ id, name })))
  }
  return {
    list,
    async choose(path: string) {
      const application = await inspect(path)
      if (!application) return null
      await list()
      const installed = current.find((candidate) => candidate.path === application.path)
      if (installed) return { id: installed.id, name: installed.name }
      const custom = await readRegistry(registry)
      if (custom.length >= 16) return null
      const added = {
        ...application,
        id: `custom-${randomUUID()}`,
        name: basename(application.path)
          .replace(/\.app$/, "")
          .slice(0, 120),
      }
      const validated = customApplicationSchema.parse(added)
      await writeRegistry(registry, [...custom, validated])
      await list()
      return { id: validated.id, name: validated.name }
    },
    async resolve(id: string) {
      await list()
      return current.find((application) => application.id === id) ?? null
    },
  }
}
