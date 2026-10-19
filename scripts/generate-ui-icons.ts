import { resolve } from "node:path"
import { z } from "zod"

const root = resolve(import.meta.dir, "..")
const directory = resolve(root, "packages/ui/src/icons")
const check = process.argv.includes("--check")
const catalog = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9-]*$/),
      label: z.string(),
      legacy: z.array(z.string()),
    }),
  )
  .parse(await Bun.file(resolve(directory, "catalog.json")).json())
const palette: Readonly<Record<string, string>> = {
  "#326db2": "geometry-stroke",
  "#e4eef9": "geometry-highlight",
  "#bfd4ee": "geometry-fill",
  "#8fb2dc": "geometry-shade",
  "#cd7b24": "action-stroke",
  "#fae5c9": "action-highlight",
  "#f1bc77": "action-fill",
  "#ba534d": "danger-stroke",
  "#f7e1de": "danger-fill",
  "#2e8065": "success-stroke",
  "#deeee6": "success-fill",
}
const attributes: Readonly<Record<string, string>> = {
  "fill-rule": "fillRule",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
}
const aliases = new Map<string, string>()
const drawings: string[] = []
for (const icon of catalog) {
  const name = `${icon.id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}Icon`
  for (const alias of [name, ...icon.legacy]) {
    if (aliases.has(alias) && aliases.get(alias) !== name)
      throw new Error(`Duplicate icon export: ${alias}`)
    aliases.set(alias, name)
  }
  const source = await Bun.file(resolve(directory, "svg", `${icon.id}.svg`)).text()
  if (!source.includes('viewBox="0 0 256 256"')) throw new Error(`Invalid icon canvas: ${icon.id}`)
  let drawing = source
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/<defs>\s*<\/defs>/, "")
  if (/<\/?(?!g\b|path\b|rect\b|circle\b|ellipse\b)[a-z]/i.test(drawing))
    throw new Error(`Unsupported SVG element: ${icon.id}`)
  drawing = drawing
    .replace(/(fill|stroke)="(#[a-f0-9]{6})"/gi, (_, attribute: string, color: string) => {
      const token = palette[color.toLowerCase()]
      if (!token) throw new Error(`Unknown icon color ${color}: ${icon.id}`)
      return `${attribute}="var(--icon-${token}, ${color})"`
    })
    .replace(
      /\b(fill-rule|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray)=/g,
      (attribute) => `${attributes[attribute.slice(0, -1)]}=`,
    )
  drawings.push(
    `export const ${name} = /* @__PURE__ */ coloredIcon(${JSON.stringify(icon.id)}, ${drawing})`,
  )
}
const banner = "// Generated from packages/ui/src/icons/svg by bun run icons:generate.\n"
const sources = new Map([
  [
    "packages/ui/src/generated/colored-icons.tsx",
    `${banner}import { coloredIcon } from "../components/colored-icon"\n\n${drawings.join("\n\n")}\n`,
  ],
  [
    "packages/ui/src/components/icons.tsx",
    banner +
      "export {\n" +
      [...aliases]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([alias, name]) => `  ${name}${alias === name ? "" : ` as ${alias}`},`)
        .join("\n") +
      '\n} from "../generated/colored-icons"\n',
  ],
])
for (const [name, source] of sources) {
  const path = resolve(root, name)
  const formatted = Bun.spawnSync(
    [process.execPath, "run", "--bun", "biome", "check", "--write", `--stdin-file-path=${path}`],
    { cwd: root, stdin: new TextEncoder().encode(source), stdout: "pipe", stderr: "pipe" },
  )
  if (formatted.exitCode !== 0) throw new Error(new TextDecoder().decode(formatted.stderr))
  const content = new TextDecoder().decode(formatted.stdout)
  if (check) {
    if ((await Bun.file(path).text()) !== content)
      throw new Error(`Generated icons are stale: ${name}`)
  } else await Bun.write(path, content)
}
console.log(`${check ? "Verified" : "Generated"} ${catalog.length} colored UI icons.`)
