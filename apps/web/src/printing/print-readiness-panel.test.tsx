import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react")

import { I18nProvider } from "@vibeshape/i18n/provider"
import { type PrintReadinessResult, preparePrintMeshes } from "@vibeshape/print-analysis"
import { i18n } from "../i18n"
import { PrintReadinessPanel } from "./print-readiness-panel"
import { printReadinessPreviewMeshes } from "./print-readiness-preview-meshes"

const source = {
  name: "Box",
  vertices: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 2, 10, 0, 2, 10, 10, 2, 0, 10, 2],
  triangles: [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ],
}
const prepared = preparePrintMeshes({
  meshes: [source],
  settings: { rotationX: 0, supports: false },
})
const report: PrintReadinessResult = {
  minimumWallMm: 0.8,
  overhangAngleDeg: 45,
  status: "warnings",
  bodies: [
    {
      name: "Box",
      topology: "closed",
      triangleCount: 12,
      thinTriangles: [0, 1],
      overhangTriangles: [1, 2],
      unknownTriangles: 0,
      minimumThicknessMm: 0.4,
      thinAreaMm2: 100,
      overhangAreaMm2: 100,
    },
  ],
}
afterEach(cleanup)
describe("print readiness presentation", () => {
  it("keeps original triangle picking identity when shading thin/overhang intersections", () => {
    const meshes = printReadinessPreviewMeshes(prepared, report)
    expect(meshes).toHaveLength(4)
    expect(meshes.find(({ outputRole }) => outputRole === "analysis-3")?.triangleFaceIds).toEqual(
      new Uint32Array([2]),
    )
    expect(String(meshes.find(({ outputRole }) => outputRole === "analysis-1")?.color)).toBe(
      "#df3746",
    )
    expect(
      meshes.flatMap(({ triangleFaceIds }) => [...triangleFaceIds]).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  })
  it("shows pending/cancel, blocks duplicates and discards canceled and stale completions", async () => {
    const calls: Parameters<NonNullable<Parameters<typeof PrintReadinessPanel>[0]["analyze"]>>[] =
      []
    const complete: ((result: PrintReadinessResult) => void)[] = []
    const published: (PrintReadinessResult | null)[] = []
    const analyze: NonNullable<Parameters<typeof PrintReadinessPanel>[0]["analyze"]> = (
      ...args
    ) => {
      calls.push(args)
      return new Promise((resolve) => complete.push(resolve))
    }
    const onResult = (value: PrintReadinessResult | null) => published.push(value)
    const view = render(
      <I18nProvider i18n={i18n}>
        <PrintReadinessPanel result={prepared} analyze={analyze} onResult={onResult} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Analyze print copy" }))
    fireEvent.click(screen.getByRole("button", { name: "Analyze print copy" }))
    expect(calls).toHaveLength(1)
    expect(screen.getByRole("progressbar")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }))
    expect(calls[0]?.[2]?.signal?.aborted).toBe(true)
    await act(async () => complete[0]?.(report))
    expect(published.includes(report)).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Analyze print copy" }))
    view.rerender(
      <I18nProvider i18n={i18n}>
        <PrintReadinessPanel result={{ ...prepared }} analyze={analyze} onResult={onResult} />
      </I18nProvider>,
    )
    expect(calls[1]?.[2]?.signal?.aborted).toBe(true)
    await act(async () => complete[1]?.(report))
    expect(published.includes(report)).toBe(false)
    expect(screen.queryByRole("progressbar")).toBeNull()
  })
})
