import { documentUpgradeV3CommandSchema } from "@vibeshape/domain/document-v3-command-schemas"
import { documentUpgradeV4CommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import type { z } from "zod"

type UpgradeEnvelope = Omit<
  z.input<typeof documentUpgradeV3CommandSchema>,
  "schemaVersion" | "kind" | "payload"
>

/** Capture both durable upgrades in the same authored transaction before adding source-backed state. */
export function sourceAuthorityUpgradeCommands(
  version: 2 | 3 | 4,
  envelope: () => UpgradeEnvelope,
) {
  const commands = []
  if (version === 2)
    commands.push(
      documentUpgradeV3CommandSchema.parse({
        ...envelope(),
        schemaVersion: 3,
        kind: "org.vibeshape.document.upgrade-v3",
        payload: { change: null },
      }),
    )
  if (version !== 4)
    commands.push(
      documentUpgradeV4CommandSchema.parse({
        ...envelope(),
        schemaVersion: 4,
        kind: "org.vibeshape.document.upgrade-v4",
        payload: {},
      }),
    )
  return commands
}
