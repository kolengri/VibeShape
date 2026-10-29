import { createLengthQuantity } from "@vibeshape/domain/units"
import type { LocalToolName } from "./local-tools"
import { printOptimizationOperation } from "./print-optimization.test-fixtures"

const id = "0195b5ac-b250-7a2c-8c33-000000000030"
const print = printOptimizationOperation()
const printArguments = {
  baseRevision: print.arguments.baseRevision,
  source: print.arguments.source,
  settings: {
    bedFace: print.arguments.settings.bedFace,
    material: print.arguments.settings.material,
  },
}
const sketchArguments = {
  draftId: id,
  baseRevision: 4,
  commandId: id,
  sketch: {
    schemaVersion: 0,
    id,
    label: "Canonical sketch",
    plane: "xy",
    entities: [{ schemaVersion: 0, id, type: "point", x: 0, y: 0, construction: false }],
    constraints: [],
  },
}

/** Omit accepted defaults to protect the advertised client contract, including nested defaults. */
export const toolInputDefaultFixtures: { name: LocalToolName; arguments: unknown }[] = [
  { name: "analyze_print_optimization", arguments: printArguments },
  { name: "request_print_optimization", arguments: { ...printArguments, label: "Exact print" } },
  { name: "list_projects", arguments: {} },
  { name: "model_parts", arguments: { revision: 4 } },
  { name: "model_history", arguments: { revision: 4 } },
  { name: "model_tree", arguments: { revision: 4 } },
  { name: "model_sketch_solution", arguments: { revision: 4, sketchId: id } },
  { name: "read_export_chunk", arguments: { exportId: id, offset: 0 } },
  {
    name: "create_cylinder",
    arguments: {
      draftId: id,
      baseRevision: 4,
      commandId: id,
      featureId: id,
      suppressed: false,
      parameters: {
        radius: createLengthQuantity(5),
        height: createLengthQuantity(10),
        centered: false,
      },
    },
  },
  { name: "create_sketch", arguments: sketchArguments },
  { name: "update_sketch", arguments: sketchArguments },
]
