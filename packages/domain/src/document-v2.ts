import { z } from "zod"
import {
  type DocumentSnapshotV1,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
} from "./document"
import {
  type DocumentSnapshotV2,
  documentSnapshotV2Schema,
  projectDocumentSnapshotV2ToV1,
} from "./document-v2-schema"
import { type DocumentSnapshotV3, documentSnapshotV3Schema } from "./document-v3-schema"
import {
  type DocumentSnapshotV4,
  documentSnapshotV4Schema,
  projectDocumentSnapshotV4ToV3,
} from "./document-v4"

import {
  type DocumentSnapshotV5,
  documentSnapshotV5Schema,
  projectDocumentSnapshotV5ToV4,
} from "./document-v5"

import {
  type DocumentSnapshotV6,
  documentSnapshotV6Schema,
  projectDocumentSnapshotV6ToV5,
} from "./document-v6"

export * from "./document-v2-schema"
export { type DocumentSnapshotV3, documentSnapshotV3Schema } from "./document-v3-schema"
export type AuthoredDocumentSnapshot =
  | DocumentSnapshotV2
  | DocumentSnapshotV3
  | DocumentSnapshotV4
  | DocumentSnapshotV5
  | DocumentSnapshotV6
export const authoredDocumentSnapshotSchema = z.union([
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSnapshotV5Schema,
  documentSnapshotV6Schema,
])
export const documentAuthorityV2SnapshotSchema = z.union([
  documentSnapshotV1Schema,
  documentSnapshotV2Schema,
])
export type DocumentAuthorityV2Snapshot = DocumentSnapshotV1 | DocumentSnapshotV2
export const documentAuthoritySnapshotSchema = z.union([
  documentSnapshotV1Schema,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSnapshotV5Schema,
  documentSnapshotV6Schema,
])
export type DocumentAuthoritySnapshot = DocumentSnapshotV1 | AuthoredDocumentSnapshot
export const portableDocumentSnapshotSchema = z.union([
  documentSnapshotSchema,
  documentSnapshotV1Schema,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSnapshotV5Schema,
  documentSnapshotV6Schema,
])
export function projectDocumentSnapshotV3ToV2(snapshot: DocumentSnapshotV3): DocumentSnapshotV2 {
  const { surfaceTextures: _textures, ...model } = documentSnapshotV3Schema.parse(snapshot)
  return documentSnapshotV2Schema.parse({ ...model, schemaVersion: 2 })
}
export function projectAuthoredDocumentSnapshotToV1(
  snapshot: AuthoredDocumentSnapshot,
): DocumentSnapshotV1 {
  const v5 = snapshot.schemaVersion === 6 ? projectDocumentSnapshotV6ToV5(snapshot) : snapshot
  const v4 = v5.schemaVersion === 5 ? projectDocumentSnapshotV5ToV4(v5) : v5
  const v3 = v4.schemaVersion === 4 ? projectDocumentSnapshotV4ToV3(v4) : v4
  return projectDocumentSnapshotV2ToV1(
    v3.schemaVersion === 3 ? projectDocumentSnapshotV3ToV2(v3) : v3,
  )
}
