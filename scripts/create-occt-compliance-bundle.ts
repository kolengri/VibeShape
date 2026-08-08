import { resolve } from "node:path"
import {
  assertLocalOcctComplianceEnvironment,
  createOcctComplianceBundle,
} from "./occt-compliance-bundle"

function main() {
  assertLocalOcctComplianceEnvironment(process.env)
  const repositoryRoot = resolve(import.meta.dir, "..")
  const artifactRoot = resolve(repositoryRoot, ".artifacts/occt-build")
  const result = createOcctComplianceBundle({ artifactRoot, repositoryRoot })

  console.log(`Verified OCCT compliance bundle: ${result.bundleDirectory}`)
  console.log(`Created OCCT compliance archive: ${result.archivePath}`)
}

try {
  main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "Unknown OCCT compliance bundle failure.")
  process.exitCode = 1
}
