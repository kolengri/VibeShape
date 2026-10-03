import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { sha256 } from "./occt-build-artifacts"
import { OCCT_COMPLIANCE_BUNDLE_NAME, verifyOcctComplianceBundle } from "./occt-compliance-bundle"
import { assertSuccessfulOcctProcess } from "./occt-process"

// Local delivery deliberately uses the source-matched kernel, never the npm feasibility artifact.
const root = resolve(import.meta.dirname, "..")
const bundle = resolve(
  process.argv[2] ?? join(root, ".artifacts/occt-build/compliance", OCCT_COMPLIANCE_BUNDLE_NAME),
)
const verified = verifyOcctComplianceBundle(bundle)
const run = (command: string, args: string[]) =>
  assertSuccessfulOcctProcess(
    spawnSync(command, args, { cwd: root, stdio: "inherit" }),
    `Local delivery: ${command}`,
  )

run(process.execPath, ["run", "solvespace:verify:runtime"])
const staged = join(root, ".artifacts/occt-build/package")
mkdirSync(staged, { recursive: true })
cpSync(join(bundle, "package"), staged, { recursive: true })
run(process.execPath, ["run", "--cwd", "apps/web", "build", "--mode", "controlled-occt"])

const dist = join(root, "apps/web/dist")
const sources = join(dist, "sources")
mkdirSync(sources, { recursive: true })
run("tar", ["-cf", join(sources, "occt-corresponding-source.tar"), "-C", bundle, "."])
cpSync(
  join(root, "third_party/solvespace/solvespace-corresponding-source.tar.gz"),
  join(sources, "solvespace-corresponding-source.tar.gz"),
)
cpSync(join(root, "LICENSE"), join(sources, "LICENSE.txt"))
cpSync(join(root, "node_modules/shadcn/LICENSE.md"), join(sources, "shadcn-LICENSE.txt"))
cpSync(join(bundle, "THIRD_PARTY_NOTICES.md"), join(sources, "OCCT-NOTICES.txt"))
cpSync(join(bundle, "REPLACEMENT.md"), join(sources, "OCCT-REPLACEMENT.txt"))
writeFileSync(
  join(sources, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>VibeShape local build sources</title>
<h1>VibeShape local build sources</h1>
<p>This local build uses Open CASCADE Technology through OpenCascade.js and the SolveSpace solver.
VibeShape is GPL-3.0-or-later. OCCT is LGPL-2.1 with its additional exception.</p>
<ul><li><a href="LICENSE.txt">VibeShape license</a></li>
<li><a href="browser-licenses.txt">Browser dependency licenses</a></li>
<li><a href="worker-licenses.txt">Worker dependency licenses</a></li>
<li><a href="shadcn-LICENSE.txt">Copied UI component license</a></li>
<li><a href="OCCT-NOTICES.txt">OCCT and binding notices</a></li>
<li><a href="OCCT-REPLACEMENT.txt">Replacing and rebuilding OCCT</a></li>
<li><a href="Noto-Sans-OFL.txt">Noto Sans font license</a> and <a href="Noto-Sans-provenance.md">font provenance</a></li>
<li><a href="opentype-js-MIT.txt">opentype.js outline SDK license</a></li>
<li><a href="occt-corresponding-source.tar">Exact OCCT sources, licenses and build recipes</a></li>
<li><a href="solvespace-corresponding-source.tar.gz">Exact SolveSpace sources, licenses and build recipes</a></li></ul>
<p>Application source is in the accompanying VibeShape checkout. This is a local delivery,
not a public release compliance certification.</p></html>\n`,
)
const artifacts = readdirSync(join(dist, "assets"))
  .filter((name) => name.endsWith(".wasm"))
  .map((name) => ({ file: `assets/${name}`, sha256: sha256(join(dist, "assets", name)) }))
for (const wasm of [
  join(staged, "src/replicad_single.wasm"),
  join(root, "packages/sketch-solver/runtime/vibeshape_slvs.wasm"),
]) {
  if (!artifacts.some((artifact) => artifact.sha256 === sha256(wasm)))
    throw new Error("The built editor does not contain the verified kernel and solver WASM.")
}
const report = {
  schemaVersion: 1,
  kernelRevision: verified.manifest.bundle.opencascadeRevision,
  sourceManifestSha256: sha256(join(bundle, "manifest.json")),
  artifacts,
  sourceArchives: ["occt-corresponding-source.tar", "solvespace-corresponding-source.tar.gz"].map(
    (name) => ({ file: `sources/${name}`, sha256: sha256(join(sources, name)) }),
  ),
}
writeFileSync(join(dist, "local-build.json"), `${JSON.stringify(report, null, 2)}\n`)
console.log("Local build prepared. Start the stdio server with bun run mcp:local.")
