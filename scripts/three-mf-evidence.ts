import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"
import { z } from "zod"

const consumerFamilySchema = z.enum(["prusa", "orca"])

const threeMfConsumerSchema = z
  .object({
    name: z.string().min(1),
    family: consumerFamilySchema,
    command: z.string().min(1),
    supportsDataDirectory: z.boolean(),
  })
  .strict()

export const threeMfConsumerResultSchema = z
  .object({
    name: z.string().min(1),
    family: consumerFamilySchema,
    executable: z.string().min(1),
    exitStatus: z.literal(0),
    facetCount: z.literal(24),
    manifoldMeshCount: z.number().int().positive(),
    volumeCubicMillimeters: z.number().finite().positive(),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const threeMfEvidenceReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifact: z
      .object({
        fileName: z.string().endsWith(".3mf"),
        byteLength: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    archive: z
      .object({
        entries: z.array(z.string()).min(3),
        xmlPartsChecked: z.number().int().positive(),
      })
      .strict(),
    writer: z
      .object({
        objectCount: z.number().int().positive(),
        meshObjectCount: z.number().int().positive(),
        componentObjectCount: z.number().int().positive(),
        buildItemCount: z.number().int().positive(),
        vertexCount: z.number().int().positive(),
        triangleCount: z.number().int().positive(),
        hasThumbnail: z.literal(true),
      })
      .strict(),
    consumers: z.array(threeMfConsumerResultSchema).min(2),
    independentConsumerFamilies: z.number().int().min(2),
  })
  .strict()

export type ThreeMfConsumer = z.infer<typeof threeMfConsumerSchema>

const MACOS_CONSUMERS: readonly ThreeMfConsumer[] = [
  {
    name: "PrusaSlicer",
    family: "prusa",
    command: "/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
    supportsDataDirectory: true,
  },
  {
    name: "OrcaSlicer",
    family: "orca",
    command: "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
    supportsDataDirectory: true,
  },
  {
    name: "Snapmaker Orca",
    family: "orca",
    command: "/Applications/Snapmaker Orca.app/Contents/MacOS/Snapmaker_Orca",
    supportsDataDirectory: true,
  },
  {
    name: "Bambu Studio",
    family: "orca",
    command: "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
    supportsDataDirectory: false,
  },
]

export function assertLocalThreeMfEnvironment(environment: Record<string, string | undefined>) {
  if (environment.CI) {
    throw new Error("3MF interoperability evidence is local-only and must not run in CI.")
  }
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function sumMetric(output: string, name: string) {
  return [...output.matchAll(new RegExp(`${name}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`, "g"))].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  )
}

export function readConsumerGeometry(output: string) {
  const manifoldStates = [...output.matchAll(/manifold\s*=\s*(yes|no)/g)].map((match) => match[1])
  const facetCount = sumMetric(output, "number_of_facets")
  const volumeCubicMillimeters = sumMetric(output, "volume")
  if (
    facetCount !== 24 ||
    manifoldStates.length === 0 ||
    manifoldStates.includes("no") ||
    Math.abs(volumeCubicMillimeters - 1_608) > 1e-6
  ) {
    throw new Error(
      `Slicer geometry mismatch: facets=${facetCount}, manifold=${manifoldStates.join(",") || "missing"}, volume=${volumeCubicMillimeters}.`,
    )
  }
  return { facetCount, manifoldMeshCount: manifoldStates.length, volumeCubicMillimeters }
}

export function resolveThreeMfConsumers(
  environment: Record<string, string | undefined>,
  platform = process.platform,
) {
  const configured = [
    environment.VIBESHAPE_PRUSASLICER_BIN
      ? {
          name: "PrusaSlicer",
          family: "prusa" as const,
          command: environment.VIBESHAPE_PRUSASLICER_BIN,
          supportsDataDirectory: true,
        }
      : undefined,
    environment.VIBESHAPE_ORCASLICER_BIN
      ? {
          name: "OrcaSlicer",
          family: "orca" as const,
          command: environment.VIBESHAPE_ORCASLICER_BIN,
          supportsDataDirectory: true,
        }
      : undefined,
  ].filter((consumer) => consumer !== undefined)
  const candidates =
    configured.length > 0 ? configured : platform === "darwin" ? MACOS_CONSUMERS : []
  return candidates
    .filter((consumer) => existsSync(consumer.command))
    .map((consumer) => threeMfConsumerSchema.parse(consumer))
}

export function assertIndependentConsumers(consumers: readonly ThreeMfConsumer[]) {
  const families = new Set(consumers.map((consumer) => consumer.family))
  if (consumers.length < 2 || families.size < 2) {
    const found = consumers.map((consumer) => `${consumer.name} (${consumer.family})`).join(", ")
    throw new Error(
      `3MF evidence requires two installed slicers from independent families; found ${found || "none"}.`,
    )
  }
}

export function readConsumerOutput(resultPath: string) {
  if (!existsSync(resultPath)) return ""
  return readFileSync(resultPath, "utf8")
}

export function consumerExecutableName(consumer: ThreeMfConsumer) {
  return basename(consumer.command)
}
