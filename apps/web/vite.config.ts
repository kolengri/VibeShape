import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import license, { type Dependency } from "rollup-plugin-license"
import { type ConfigEnv, defineConfig, type Plugin, type ViteDevServer } from "vite"
import { structuralRuntimePlugin } from "./structural-runtime-plugin.ts"
import { WorkerLicenseInventory } from "./worker-license-inventory"

function retainedNotice(file: string) {
  return readFileSync(resolve(import.meta.dirname, "../../deployment/licenses", file), "utf8")
}

function embeddedReplicadNotice(key: string) {
  if (key !== "replicad@0.23.1")
    throw new Error("Review Replicad's embedded dependency notices before changing its version.")
  return retainedNotice("replicad-0.23.1-embedded-NOTICES.txt")
}

function missingPackageLicense(key: string) {
  // These exact npm releases omit LICENSE; retain their reviewed upstream notices.
  if (key === "saxes@6.0.0:ISC") return retainedNotice("saxes-6.0.0-LICENSE.txt")
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

function bundledLicensePlugins(fileName: string, inventory?: WorkerLicenseInventory): Plugin[] {
  let notices = ""
  const collector = license({
    thirdParty: {
      multipleVersions: true,
      output(dependencies) {
        notices = dependencies
          .map((dependency) => {
            const notice = completeDependencyNotice(dependency)
            inventory?.add(dependency.name, dependency.version, notice)
            return notice
          })
          .join("\n\n---\n\n")
      },
    },
  })
  return [
    // Vite 8 implements Rollup hooks but narrows optional plugin metadata types.
    collector as unknown as Plugin,
    {
      name: "vibeshape-bundled-license-asset",
      generateBundle() {
        if (inventory) return
        if (!notices) throw new Error("The bundled license inventory is empty.")
        this.emitFile({ type: "asset", fileName, source: notices })
      },
    },
  ]
}

function workerLicenseNotices(inventory: WorkerLicenseInventory): Plugin {
  return {
    name: "vibeshape-worker-license-inventory",
    buildStart() {
      inventory.clear()
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sources/worker-licenses.txt",
        source: inventory.text(),
      })
    },
  }
}

function f3dSourceNotices(): Plugin {
  return {
    name: "vibeshape-f3d-source-notices",
    generateBundle() {
      const directory = resolve(import.meta.dirname, "../../packages/formats/src/f3d")
      for (const [source, fileName] of [
        ["NOTICE.md", "sources/Extrudo-F3D-NOTICE.md"],
        ["FORMAT.md", "sources/F3D-FORMAT.md"],
      ] as const) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(directory, source)) })
      }
    },
  }
}

function sketchTextNotices(): Plugin {
  return {
    name: "vibeshape-sketch-text-notices",
    generateBundle() {
      const directory = resolve(import.meta.dirname, "../../packages/formats/src/text-outline")
      for (const [source, fileName] of [
        ["fonts/OFL.txt", "sources/Noto-Sans-OFL.txt"],
        ["fonts/provenance.md", "sources/Noto-Sans-provenance.md"],
        ["LICENSE.opentype.txt", "sources/opentype-js-MIT.txt"],
      ] as const)
        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(directory, source)) })
    },
  }
}

async function developmentPlugins({ command, isPreview }: ConfigEnv): Promise<Plugin[]> {
  if (command !== "serve" || isPreview) return []
  const { developmentMcpPlugin } = await import("@vibeshape/mcp-server/development-plugin")
  return [developmentMcpPlugin()]
}

function uiPluginRuntimeHeaders(): Plugin {
  const configure = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split("?", 1)[0]
      const runtime =
        path === "/src/features/extensions/ui-panel-runtime.js" ||
        /^\/assets\/ui-panel-runtime-[\w-]+\.js$/.test(path ?? "")
      if (runtime) {
        response.setHeader("Access-Control-Allow-Origin", "*")
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
      }
      next()
    })
  }
  return {
    name: "vibeshape-ui-plugin-runtime-headers",
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export default defineConfig(async (environment) => {
  const { mode } = environment
  const controlledOcct = mode === "controlled-occt"
  const workerInventory = new WorkerLicenseInventory()

  return {
    // Worker-only imports escape the initial crawl; discovering them on New project reloads the page.
    optimizeDeps: { include: ["replicad", "replicad-opencascadejs"] },
    plugins: [
      uiPluginRuntimeHeaders(),
      ...(await developmentPlugins(environment)),
      react(),
      tailwindcss(),
      sketchTextNotices(),
      f3dSourceNotices(),
      workerLicenseNotices(workerInventory),
      structuralRuntimePlugin(),
      ...bundledLicensePlugins("sources/browser-licenses.txt"),
    ],
    worker: {
      plugins: () => bundledLicensePlugins("sources/worker-licenses.txt", workerInventory),
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
