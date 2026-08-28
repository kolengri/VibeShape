import { writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { chromium, type Page } from "@playwright/test"
import type { FlatSketchSystemInput } from "../packages/sketch-solver/src"
import { assertLocalSolveSpaceBuild, SOLVESPACE_BUILD_INPUTS } from "./solvespace-build-config"
import {
  createConstraintCoverageFixtures,
  createDegenerateLineFixture,
  createLineFixture,
  createPointAlignmentConflictFixture,
} from "./solvespace-fixtures"

const repositoryRoot = resolve(import.meta.dir, "..")
const artifactRoot = join(repositoryRoot, ".artifacts", "solvespace-build")
const outputRoot = join(artifactRoot, "output")

async function findAvailablePort() {
  return new Promise<number>((resolvePort, rejectPort) => {
    const reservation = createServer()
    reservation.once("error", rejectPort)
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address()
      if (!address || typeof address === "string") {
        reservation.close()
        rejectPort(new Error("Failed to reserve a local browser evidence port."))
        return
      }
      reservation.close((error) => (error ? rejectPort(error) : resolvePort(address.port)))
    })
  })
}

function serializeSystem(
  name: string,
  system: FlatSketchSystemInput,
  expectedFailedConstraint?: number,
) {
  return {
    name,
    expectedFailedConstraint,
    parameterMetadata: [...system.parameterMetadata],
    parameterValues: [...system.parameterValues],
    entityRecords: [...system.entityRecords],
    constraintRecords: [...system.constraintRecords],
    constraintValues: [...system.constraintValues],
    draggedParameters: [...system.draggedParameters],
    solveGroup: system.solveGroup,
    calculateFailedConstraints: system.calculateFailedConstraints ?? true,
  }
}

type SerializedSystem = ReturnType<typeof serializeSystem>

interface BrowserSolveResult {
  abiStatus: number
  degreesOfFreedom: number
  failedConstraints: number[]
  maximumResidual: number
  name: string
  expectedFailedConstraint?: number
  solverStatus: number
}

interface WorkerReport {
  durationMs: number
  error?: string
  heapAfterBytes: number
  heapBeforeBytes: number
  results: BrowserSolveResult[]
}

const workerSource = `
import createSolver from "/${SOLVESPACE_BUILD_INPUTS.outputModule}";

const solverPromise = createSolver({
  locateFile: (file) => new URL(file, self.location.href).href,
});

self.onmessage = async (event) => {
  try {
    const solver = await solverPromise;
    const startedAt = performance.now();
    const heapBeforeBytes = solver.getHeapCapacityBytes();
    const results = event.data.map((fixture) => {
      const result = solver.solveFlatSystem(
        new Uint32Array(fixture.parameterMetadata),
        new Float64Array(fixture.parameterValues),
        new Uint32Array(fixture.entityRecords),
        new Uint32Array(fixture.constraintRecords),
        new Float64Array(fixture.constraintValues),
        new Uint32Array(fixture.draggedParameters),
        fixture.solveGroup,
        fixture.calculateFailedConstraints,
      );
      return {
        name: fixture.name,
        expectedFailedConstraint: fixture.expectedFailedConstraint,
        abiStatus: result.abiStatus,
        solverStatus: result.solverStatus,
        degreesOfFreedom: result.degreesOfFreedom,
        maximumResidual: result.maximumResidual,
        failedConstraints: [...result.failedConstraints],
      };
    });
    self.postMessage({
      durationMs: performance.now() - startedAt,
      heapBeforeBytes,
      heapAfterBytes: solver.getHeapCapacityBytes(),
      results,
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
`

function startEvidenceServer(port: number) {
  const responseFactories = new Map<string, () => Response>([
    [
      "/",
      () =>
        new Response("<!doctype html><title>SolveSpace evidence</title>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ],
    [
      "/solver-evidence-worker.js",
      () =>
        new Response(workerSource, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        }),
    ],
    [
      `/${SOLVESPACE_BUILD_INPUTS.outputModule}`,
      () =>
        new Response(Bun.file(join(outputRoot, SOLVESPACE_BUILD_INPUTS.outputModule)), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        }),
    ],
    [
      `/${SOLVESPACE_BUILD_INPUTS.outputWasm}`,
      () =>
        new Response(Bun.file(join(outputRoot, SOLVESPACE_BUILD_INPUTS.outputWasm)), {
          headers: { "content-type": "application/wasm" },
        }),
    ],
  ])
  return Bun.serve({
    port,
    fetch(request) {
      const path = new URL(request.url).pathname
      const factory = responseFactories.get(path)
      return factory ? factory() : new Response("Not found", { status: 404 })
    },
  })
}

function createSerializedFixtures() {
  const pointAlignmentConflict = createPointAlignmentConflictFixture()
  return [
    serializeSystem("under-constrained", createLineFixture("under").system),
    serializeSystem("fully-constrained", createLineFixture("fully").system),
    serializeSystem("over-constrained", createLineFixture("over").system),
    serializeSystem(
      "point-alignment-conflict",
      pointAlignmentConflict.system,
      pointAlignmentConflict.alignmentConstraintHandle,
    ),
    ...createConstraintCoverageFixtures().map((fixture) =>
      serializeSystem(fixture.name, fixture.system),
    ),
    serializeSystem("degenerate line", createDegenerateLineFixture()),
  ]
}

async function runWorker(page: Page, fixtures: SerializedSystem[]) {
  return page.evaluate(
    ({ fixtures: workerFixtures }) =>
      new Promise<WorkerReport>((resolveReport, rejectReport) => {
        const worker = new Worker("/solver-evidence-worker.js", { type: "module" })
        const timeout = globalThis.setTimeout(() => {
          worker.terminate()
          rejectReport(new Error("SolveSpace worker evidence timed out."))
        }, 10_000)
        worker.onerror = (event) => {
          globalThis.clearTimeout(timeout)
          worker.terminate()
          rejectReport(new Error(event.message))
        }
        worker.onmessage = (event) => {
          globalThis.clearTimeout(timeout)
          worker.terminate()
          resolveReport(event.data as WorkerReport)
        }
        worker.postMessage(workerFixtures)
      }),
    { fixtures },
  )
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function findResult(results: BrowserSolveResult[], name: string) {
  const result = results.find((candidate) => candidate.name === name)
  requireCondition(result, `Browser worker omitted ${name}.`)
  return result
}

function validateWorkerReport(report: WorkerReport) {
  requireCondition(
    typeof report.error !== "string",
    report.error ?? "Unknown browser worker error.",
  )
  for (const result of report.results) {
    requireCondition(result.abiStatus === 0, `Browser worker rejected ${result.name}.`)
    requireCondition(
      Number.isFinite(result.maximumResidual),
      `${result.name} residual is not finite.`,
    )
  }

  const fully = findResult(report.results, "fully-constrained")
  requireCondition(fully.solverStatus === 0, "Fully constrained browser status was invalid.")
  requireCondition(fully.degreesOfFreedom === 0, "Fully constrained browser DOF was invalid.")
  const under = findResult(report.results, "under-constrained")
  requireCondition(under.solverStatus === 0, "Under-constrained browser status was invalid.")
  requireCondition(under.degreesOfFreedom > 0, "Under-constrained browser DOF was invalid.")
  const over = findResult(report.results, "over-constrained")
  requireCondition(
    new Set([1, 4]).has(over.solverStatus),
    "Over-constrained browser status was invalid.",
  )
  requireCondition(over.failedConstraints.length > 0, "Browser conflict set was empty.")
  const pointAlignmentConflict = findResult(report.results, "point-alignment-conflict")
  requireCondition(
    new Set([1, 4]).has(pointAlignmentConflict.solverStatus),
    "Point alignment browser conflict status was invalid.",
  )
  requireCondition(
    pointAlignmentConflict.expectedFailedConstraint !== undefined &&
      pointAlignmentConflict.failedConstraints.includes(
        pointAlignmentConflict.expectedFailedConstraint,
      ),
    "Point alignment browser conflict handle was missing.",
  )
  const angle = findResult(report.results, "angle")
  requireCondition(angle.maximumResidual > 0, "Browser residual capture returned only zero.")
}

async function collectBrowserReport(port: number, fixtures: SerializedSystem[]) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/`)
    const userAgent = await page.evaluate(() => navigator.userAgent)
    const workerReport = await runWorker(page, fixtures)
    validateWorkerReport(workerReport)
    return {
      schemaVersion: 1,
      browser: "chromium",
      userAgent,
      fixtureCount: workerReport.results.length,
      ...workerReport,
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  assertLocalSolveSpaceBuild()
  const port = await findAvailablePort()
  const server = startEvidenceServer(port)
  try {
    const report = await collectBrowserReport(port, createSerializedFixtures())
    writeFileSync(
      join(artifactRoot, "browser-evidence-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    console.log(JSON.stringify(report, null, 2))
  } finally {
    server.stop(true)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown browser evidence failure.")
  process.exitCode = 1
})
