import type { PyodideInterface } from "pyodide"
import { z } from "zod"
import { quickGridMetadataSchema, quickGridSchema } from "./quick-isosurface"

const preparedSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), grid: quickGridMetadataSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }).strict(),
    })
    .strict(),
])

/** Include transport evidence without disclosing captured geometry in diagnostics. */
export function parseQuickRuntimeJson(
  raw: unknown,
  label: "prepared grid" | "generated mesh",
): unknown {
  if (typeof raw !== "string")
    throw new Error(`The ${label} response must be JSON; received ${typeof raw}.`)
  try {
    return JSON.parse(raw)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.name : "ParseError"
    throw new Error(
      `The ${label} response is invalid JSON (${raw.length} UTF-16 code units): ${detail}`,
      { cause },
    )
  }
}

function copySamples(runtime: PyodideInterface, name: "envelope" | "lattice") {
  const raw: unknown = runtime.runPython(`_QUICK_CONTEXT['${name}']`)
  try {
    const proxy = z.instanceof(runtime.ffi.PyBuffer).parse(raw)
    const view = proxy.getBuffer()
    try {
      if (!(view.data instanceof Float64Array) || !view.c_contiguous || view.ndim !== 1)
        throw new Error(`The ${name} grid requires contiguous float64 samples.`)
      // Own the copy before another Python call can grow the WASM heap.
      return view.data.slice(view.offset, view.offset + (view.shape[0] as number))
    } finally {
      view.release()
    }
  } finally {
    if (raw instanceof runtime.ffi.PyProxy) raw.destroy()
  }
}

/** Transfer numerical fields as owned buffers, never as a monolithic JSON string. */
export async function prepareQuickGrid(runtime: PyodideInterface) {
  const raw: unknown = await runtime.runPythonAsync("prepare_quick_grid_json(_quick_request_json)")
  const metadata = preparedSchema.parse(parseQuickRuntimeJson(raw, "prepared grid"))
  if (!metadata.ok) return metadata
  return {
    ok: true as const,
    grid: quickGridSchema.parse({
      ...metadata.grid,
      envelope: copySamples(runtime, "envelope"),
      lattice: copySamples(runtime, "lattice"),
    }),
  }
}
