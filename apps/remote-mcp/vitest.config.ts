import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        kvNamespaces: ["OAUTH_KV"],
        bindings: {
          PUBLIC_ORIGIN: "https://mcp.example",
          EDITOR_ORIGIN: "https://editor.example",
          TURNSTILE_SITE_KEY: "test-site-key",
          TURNSTILE_SECRET_KEY: "test-secret-key",
        },
      },
    }),
  ],
  test: { include: ["src/**/*.worker.test.ts"], testTimeout: 15_000 },
})
