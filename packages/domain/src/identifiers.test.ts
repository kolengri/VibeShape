import { describe, expect, it } from "vitest"
import {
  commandIdSchema,
  moduleVersionSchema,
  technicalIdentifierSchema,
  timestampSchema,
} from "./identifiers"

describe("domain identifiers", () => {
  it("accepts lowercase UUIDv7 command identifiers", () => {
    expect(commandIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f21ac")).toBe(
      "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
    )
  })

  it.each(["", "550e8400-e29b-41d4-a716-446655440000", "0195B5AC-B213-7F2C-9C33-67A36A7F21AC"])(
    "rejects invalid UUIDv7 command identifiers: %s",
    (identifier) => {
      expect(commandIdSchema.safeParse(identifier).success).toBe(false)
    },
  )

  it.each(["org.vibeshape.core.document", "com.example.print-profile"])(
    "accepts reverse-DNS technical identifiers: %s",
    (identifier) => {
      expect(technicalIdentifierSchema.safeParse(identifier).success).toBe(true)
    },
  )

  it.each(["Document", "org", "org-vibeshape", "org.VibeShape.document", "org..document"])(
    "rejects non-canonical technical identifiers: %s",
    (identifier) => {
      expect(technicalIdentifierSchema.safeParse(identifier).success).toBe(false)
    },
  )

  it.each(["0.1.0", "1.2.3-alpha.1+build.7"])(
    "accepts exact semantic module versions: %s",
    (version) => {
      expect(moduleVersionSchema.safeParse(version).success).toBe(true)
    },
  )

  it.each(["v1.2.3", "1.2", "latest", "01.2.3", "1.2.3-01"])(
    "rejects non-exact semantic module versions: %s",
    (version) => {
      expect(moduleVersionSchema.safeParse(version).success).toBe(false)
    },
  )

  it("requires timestamps with explicit timezone offsets", () => {
    expect(timestampSchema.safeParse("2026-08-08T12:00:00Z").success).toBe(true)
    expect(timestampSchema.safeParse("2026-08-08T14:00:00+02:00").success).toBe(true)
    expect(timestampSchema.safeParse("2026-08-08T12:00:00").success).toBe(false)
  })
})
