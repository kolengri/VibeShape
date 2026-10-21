import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join } from "node:path"
import { resolveSlicerExecutable, slicerNames } from "@vibeshape/slicer-bridge/native"
import {
  nativeCustomSlicerIdSchema,
  nativeSlicerTargetsSchema,
} from "@vibeshape/slicer-handoff/native"
import { slicerIdSchema } from "@vibeshape/slicer-handoff/protocol"
import { z } from "zod"
import type { NativeSlicerApplication } from "./native-slicer-launcher"
import { preparePrivateDirectory, readPrivateFile, writePrivateFile } from "./private-files"

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
  // Windows X_OK checks existence; shell-free launches require an executable target.
  if (process.platform === "win32" && extname(canonical).toLowerCase() !== ".exe") return null
  const metadata = await stat(canonical)
  if (canonical.endsWith(".app") && metadata.isDirectory()) {
    if (!(await stat(join(canonical, "Contents/Info.plist")).catch(() => null))?.isFile())
      return null
    return { path: canonical, kind: "bundle" as const }
  }
  return (await isExecutable(canonical)) ? { path: canonical, kind: "executable" as const } : null
}
async function readRegistry(path: string) {
  try {
    const buffer = await readPrivateFile(path, 65536)
    return registrySchema.parse(JSON.parse(buffer.toString("utf8")))
  } catch {
    return []
  }
}
async function writeRegistry(path: string, applications: z.infer<typeof registrySchema>) {
  preparePrivateDirectory(dirname(path))
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writePrivateFile(temporary, JSON.stringify(registrySchema.parse(applications)))
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
  async function readCustomApplications() {
    const custom = await Promise.all(
      (await readRegistry(registry)).map(async (saved) => {
        const application = await inspect(saved.path)
        return application && application.path === saved.path && application.kind === saved.kind
          ? saved
          : null
      }),
    )
    return custom.filter((application) => application !== null)
  }
  async function list() {
    const installed = await Promise.all(
      slicerIdSchema.options.map(async (id) => {
        const executable = await (options.resolve ?? resolveSlicerExecutable)({
          slicerId: id,
          environment: options.env ?? process.env,
          pathIsExecutable: isExecutable,
        })
        if (!executable) return null
        const bundle = dirname(dirname(dirname(executable)))
        const application = await inspect(bundle.endsWith(".app") ? bundle : executable)
        return application ? { ...application, id, name: slicerNames[id] } : null
      }),
    )
    const custom = await readCustomApplications()
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
      const custom = await readCustomApplications()
      if (custom.length >= 16) return null
      const added = {
        ...application,
        id: `custom-${randomUUID()}`,
        name: basename(application.path)
          .replace(/\.(app|exe)$/i, "")
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
