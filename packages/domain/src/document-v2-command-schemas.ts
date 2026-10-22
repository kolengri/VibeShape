import { z } from "zod"
import { documentV2EventSchema } from "./document-v2-command-core"
import { documentV3EventSchema } from "./document-v3-command-schemas"
import { documentV4EventSchema } from "./document-v4-command-schemas"
import { documentV5EventSchema } from "./document-v5-command-schemas"
import { documentV6EventSchema } from "./document-v6-command-schemas"
import { versionedDocumentEventSchema } from "./versioned-document-commands"

export * from "./document-v2-command-core"
export * from "./document-v3-command-schemas"
export const documentAuthorityV2EventSchema = z.union([
  versionedDocumentEventSchema,
  documentV2EventSchema,
])
export type DocumentAuthorityV2Event = Readonly<z.infer<typeof documentAuthorityV2EventSchema>>
export const documentAuthorityEventSchema = z.union([
  documentAuthorityV2EventSchema,
  documentV3EventSchema,
  documentV4EventSchema,
  documentV5EventSchema,
  documentV6EventSchema,
])
export type DocumentAuthorityEvent = Readonly<z.infer<typeof documentAuthorityEventSchema>>
