import { resolve } from "node:path"
import { z } from "zod"
import { uiIconSource } from "./ui-icon-source"

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
  "#eff7ff": "material-top-start",
  "#c8ddf2": "material-top-end",
  "#b6d3ee": "material-front-start",
  "#82afd8": "material-front-end",
  "#7eacd3": "material-side-start",
  "#5385b5": "material-side-end",
  "#5784b0": "geometry-ink",
  "#547ca2": "geometry-recess",
  "#52657d": "text",
  "#eef8f2": "success-start",
  "#c7e0d3": "success-end",
  "#fff1ef": "danger-start",
  "#efcbc7": "danger-end",
  "#fff2dd": "warning-start",
  "#efcf99": "warning-end",
  "#f9d9aa": "amber-start",
  "#efb56b": "amber-end",
}
const attributes: Readonly<Record<string, string>> = {
  "fill-rule": "fillRule",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-opacity": "strokeOpacity",
  "stop-color": "stopColor",
}
const aliases = new Map<string, string>()
const drawings: string[] = []
function drawingSource(source: string) {
  return source
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/<defs>\s*<\/defs>/, "")
}

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
  let drawing = drawingSource(source)
  if (
    /<\/?(?!g\b|path\b|rect\b|circle\b|ellipse\b|defs\b|linearGradient\b|radialGradient\b|stop\b|mask\b)[a-z]/i.test(
      drawing,
    )
  )
    throw new Error(`Unsupported SVG element: ${icon.id}`)
  drawing = drawingSource(uiIconSource(source))
    .replace(
      /(fill|stroke|stop-color)="(#[a-f0-9]{6})"/gi,
      (_, attribute: string, color: string) => {
        const token =
          icon.id === "indicator-check" && color === "#2e8065"
            ? "indicator-check"
            : palette[color.toLowerCase()]
        if (!token) throw new Error(`Unknown icon color ${color}: ${icon.id}`)
        return `${attribute}="var(--icon-${token}, ${color})"`
      },
    )
    .replace(
      /\b(fill-rule|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-opacity|stop-color)=/g,
      (attribute) => `${attributes[attribute.slice(0, -1)]}=`,
    )
    .replace(/style="mask-type:luminance"/g, 'style={{ maskType: "luminance" }}')
    .replace(/id="([^"]+)"/g, (_, id: string) => `id={\`\${instanceId}-${id}\`}`)
    .replace(
      /(fill|stroke|mask)="url\(#([^)]+)\)"/g,
      (_, attribute: string, id: string) => `${attribute}={\`url(#\${instanceId}-${id})\`}`,
    )
  const scoped = /\bid=\{/.test(drawing)
  drawings.push(
    `export const ${name} = /* @__PURE__ */ coloredIcon(${JSON.stringify(icon.id)}, ${scoped ? `(instanceId) => (<>${drawing}</>)` : drawing})`,
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
