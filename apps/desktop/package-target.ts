import { z } from "zod"

export function packageTarget(args: string[], platform = process.platform, arch = process.arch) {
  const host = z.enum(["darwin", "win32"]).parse(platform)
  const windows = args[0] === "--windows"
  const [destination, requestedArch, bundle] = z
    .tuple([z.string().min(1), z.enum(["arm64", "x64"]).optional(), z.string().min(1).optional()])
    .parse(windows ? args.slice(1) : args)
  const target = windows ? "win32" : host
  const architecture = z
    .enum(["arm64", "x64"])
    .parse(requestedArch ?? (target === "win32" ? "x64" : arch))
  if (target === "win32" && architecture !== "x64")
    throw new Error("Windows desktop packaging supports x64 only.")
  return { destination, arch: architecture, bundle, platform: target }
}
