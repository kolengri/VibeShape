import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import license, { type Dependency } from "rollup-plugin-license"
import { defineConfig, type Plugin } from "vite"

function retainedNotice(file: string) {
  return readFileSync(resolve(import.meta.dirname, "../../deployment/licenses", file), "utf8")
}

function embeddedReplicadNotice(key: string) {
  if (key !== "replicad@0.23.1")
    throw new Error("Review Replicad's embedded dependency notices before changing its version.")
  return retainedNotice("replicad-0.23.1-embedded-NOTICES.txt")
}

function missingPackageLicense(key: string) {
  // This npm release omits LICENSE; retain the upstream maintainer's text.
  if (key !== "react-remove-scroll-bar@2.3.8:MIT")
    throw new Error(`A bundled dependency is missing license text: ${key}`)
  return retainedNotice("react-remove-scroll-bar-2.3.8-LICENSE.txt")
}

function completeDependencyNotice(dependency: Dependency) {
  const key = `${dependency.name}@${dependency.version}`
  let supplement = ""
  if (dependency.name === "replicad") supplement = embeddedReplicadNotice(key)
  if (!dependency.licenseText) supplement = missingPackageLicense(`${key}:${dependency.license}`)
  return `${dependency.text()}\n\n${supplement}`
}

function bundledLicensePlugins(fileName: string): Plugin[] {
  let notices = ""
  const collector = license({
    thirdParty: {
      multipleVersions: true,
      output(dependencies) {
        notices = dependencies.map(completeDependencyNotice).join("\n\n---\n\n")
      },
    },
  })
  return [
    // Vite 8 implements Rollup hooks but narrows optional plugin metadata types.
    collector as unknown as Plugin,
    {
      name: "vibeshape-bundled-license-asset",
      generateBundle() {
        if (!notices) throw new Error("The bundled license inventory is empty.")
        this.emitFile({ type: "asset", fileName, source: notices })
      },
    },
  ]
}

export default defineConfig(({ mode }) => {
  const controlledOcct = mode === "controlled-occt"

  return {
    plugins: [react(), tailwindcss(), ...bundledLicensePlugins("sources/browser-licenses.txt")],
    worker: {
      plugins: () => bundledLicensePlugins("sources/worker-licenses.txt"),
    },
    ...(controlledOcct
      ? {
          resolve: {
            alias: {
              "replicad-opencascadejs": resolve(
                import.meta.dirname,
                "../../.artifacts/occt-build/package",
              ),
            },
          },
        }
      : {}),
  }
})
