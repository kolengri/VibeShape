import { type SectionCapSource, sectionCapPositions } from "./section-cap"
import { type SectionCapResponse, sectionCapRequestSchema } from "./section-cap-protocol"

/** One retained scene keeps the exact extractor's snapshot-scoped topology cache warm. */
export class SectionCapRuntime {
  #sources: readonly SectionCapSource[] | null = null

  process(value: unknown): SectionCapResponse {
    const parsed = sectionCapRequestSchema.safeParse(value)
    if (!parsed.success)
      return { version: 1, type: "sectionCapsFailed", jobId: 0, code: "invalid-request" }
    const request = parsed.data
    if (request.sources) this.#sources = request.sources
    if (!this.#sources)
      return {
        version: 1,
        type: "sectionCapsFailed",
        jobId: request.jobId,
        code: "missing-sources",
      }
    try {
      return {
        version: 1,
        type: "sectionCapsComputed",
        jobId: request.jobId,
        caps: this.#sources.map((source) => sectionCapPositions(source, request.section)),
      }
    } catch {
      return {
        version: 1,
        type: "sectionCapsFailed",
        jobId: request.jobId,
        code: "computation-failed",
      }
    }
  }
}
