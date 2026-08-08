import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => {
  const controlledOcct = mode === "controlled-occt"

  return {
    plugins: [react(), tailwindcss()],
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
