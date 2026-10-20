import { describe, expect, it, spyOn } from "bun:test"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import { type DocumentSnapshot, featureIdSchema } from "@vibeshape/domain"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"
import { extrusionBodyOptions } from "../extrusion/extrusion-body-options"
import { extrusionBodyFixture } from "../extrusion/extrusion-body-test-fixtures"
import { loftSupportCatalogue } from "../sweep-loft/loft-support-catalogue"
import { referenceFrameOptions } from "./reference-frame-options"

function fixture(count: number) {
  const seed = extrusionBodyFixture(undefined, false, "PLANE")
  if (!seed.rebuild.ok) throw new Error("Expected rebuild fixture")
  const source = seed.snapshot.features[0]
  const geometry = seed.rebuild.response.geometry[0]
  if (!source || !geometry) throw new Error("Expected producer fixture")
  const features = Array.from({ length: count }, (_, index) => ({
    ...source,
    id: featureIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${String(index + 100).padStart(12, "0")}`),
  }))
  return {
    snapshot: { ...seed.snapshot, features },
    rebuild: {
      ok: true as const,
      response: {
        ...seed.rebuild.response,
        geometry: features.map(({ id }) => ({ ...geometry, featureId: id })),
        evaluation: {
          ...seed.rebuild.response.evaluation,
          records: features.map(({ id }) => ({
            featureId: id,
            status: "succeeded" as const,
            contentHash: geometry.contentHash,
          })),
        },
      },
    },
  }
}

const builders: {
  name: string
  count: (snapshot: DocumentSnapshot, rebuild: DocumentRebuildOutcome, excluded?: string) => number
  ambiguousCount: number
}[] = [
  {
    name: "referenceFrameOptions",
    count: (snapshot, rebuild, excluded) =>
      referenceFrameOptions(snapshot, rebuild, excluded).planes.length,
    ambiguousCount: 0,
  },
  {
    name: "extrusionBodyOptions",
    count: (snapshot, rebuild, excluded) =>
      extrusionBodyOptions(
        snapshot,
        rebuild,
        excluded,
        () => "Body",
        () => "Legacy",
      ).reduce((count, option) => count + (option.faces?.length ?? 0), 0),
    ambiguousCount: 0,
  },
  {
    name: "loftSupportCatalogue",
    count: (snapshot, rebuild, excluded) =>
      loftSupportCatalogue(snapshot, rebuild, excluded ?? null, () => "Face").length,
    ambiguousCount: 2,
  },
]

for (const builder of builders)
  describe(builder.name, () => {
    it.each([1, 8, 32])(
      "fully validates once for %i bodies through the production builder",
      (count) => {
        const { snapshot, rebuild } = fixture(count)
        const parse = spyOn(documentWorkerResponseSchema, "safeParse")
        try {
          expect(builder.count(snapshot, rebuild)).toBe(count)
          expect(parse).toHaveBeenCalledTimes(1)
        } finally {
          parse.mockRestore()
        }
      },
    )

    it("keeps editing scope and never reuses a previous invocation's response", () => {
      const { snapshot, rebuild } = fixture(3)
      expect(builder.count(snapshot, rebuild, snapshot.features[1]?.id)).toBe(1)
      expect(builder.count(snapshot, rebuild)).toBe(3)
      const response = rebuild.response
      const invalid = [
        { ...response, revision: response.revision - 1 },
        { ...response, documentId: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000999") },
        { ...response, geometry: response.geometry.slice(0, 1) },
        { ...response, geometry: [...response.geometry, ...response.geometry] },
        {
          ...response,
          geometry: response.geometry.map((geometry) => ({
            ...geometry,
            contentHash: "b".repeat(64),
          })),
        },
        {
          ...response,
          evaluation: {
            ...response.evaluation,
            records: [
              response.evaluation.records[0],
              response.evaluation.records[0],
              response.evaluation.records[0],
            ].filter((record) => record !== undefined),
          },
        },
        {
          ...response,
          geometry: response.geometry.map((geometry) => ({
            ...geometry,
            geometry: { ...geometry.geometry, shape: { ...geometry.geometry.shape, valid: false } },
          })),
        },
      ]
      for (const changed of invalid)
        expect(builder.count(snapshot, { ok: true, response: changed })).toBe(0)
      expect(
        builder.count(
          {
            ...snapshot,
            features: snapshot.features.map((feature) => ({ ...feature, suppressed: true })),
          },
          rebuild,
        ),
      ).toBe(0)
      expect(
        builder.count(snapshot, {
          ok: false,
          diagnostic: {
            code: "rebuild-failed",
            message: "Unavailable",
            retryable: false,
            sourceCode: null,
          },
        }),
      ).toBe(0)
      expect(builder.count(snapshot, rebuild)).toBe(3)
    })

    it("preserves the builder's existing ambiguity policy inside the exact body", () => {
      const { snapshot, rebuild } = fixture(1)
      for (const record of rebuild.response.geometry) {
        const body = record.geometry.bodies?.[0]
        const first = body?.topologyCandidates[0]
        if (!body || !first) throw new Error("Expected face fixture")
        body.shape = { ...body.shape, faceCount: 2 }
        body.topologyCandidates = [first, { ...first, candidateId: "coincident", meshFaceId: 2 }]
        record.geometry.shape = { ...record.geometry.shape, faceCount: 2 }
      }
      expect(builder.count(snapshot, rebuild)).toBe(builder.ambiguousCount)
    })
  })
