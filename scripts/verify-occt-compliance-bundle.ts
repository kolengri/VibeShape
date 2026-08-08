import { resolve } from "node:path"
import { OCCT_COMPLIANCE_BUNDLE_NAME, verifyOcctComplianceBundle } from "./occt-compliance-bundle"

function main() {
  const repositoryRoot = resolve(import.meta.dir, "..")
  const defaultBundle = resolve(
    repositoryRoot,
    ".artifacts/occt-build/compliance",
    OCCT_COMPLIANCE_BUNDLE_NAME,
  )
  const bundleDirectory = resolve(process.argv[2] ?? defaultBundle)
  const result = verifyOcctComplianceBundle(bundleDirectory)

  console.log(
    `Verified ${String(result.fileCount)} files in OCCT compliance bundle ${bundleDirectory}.`,
  )
}

try {
  main()
} catch (error: unknown) {
  console.error(
    error instanceof Error ? error.message : "Unknown OCCT compliance verification failure.",
  )
  process.exitCode = 1
}
