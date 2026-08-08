import type {
  BRepBuilderAPI_MakeShape,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
  TopTools_ListOfShape,
} from "replicad-opencascadejs"

export interface OcctHistoryStats {
  sourceCount: number
  modifiedSourceCount: number
  modifiedRelationCount: number
  generatedSourceCount: number
  generatedRelationCount: number
  deletedSourceCount: number
}

export interface OcctBooleanHistory {
  vertices: OcctHistoryStats
  edges: OcctHistoryStats
  faces: OcctHistoryStats
  solids: OcctHistoryStats
}

export interface OcctFilletHistory {
  vertices: OcctHistoryStats
  edges: OcctHistoryStats
  faces: OcctHistoryStats
}

type HistoryRelation = "modified" | "generated" | "deleted"
type HistoryBuilder = Pick<BRepBuilderAPI_MakeShape, "Modified" | "Generated" | "IsDeleted">

function createHistoryStats(): OcctHistoryStats {
  return {
    sourceCount: 0,
    modifiedSourceCount: 0,
    modifiedRelationCount: 0,
    generatedSourceCount: 0,
    generatedRelationCount: 0,
    deletedSourceCount: 0,
  }
}

function readRelationCount(list: TopTools_ListOfShape) {
  try {
    return list.Size()
  } finally {
    list.delete()
  }
}

function captureSourceHistory(
  builder: HistoryBuilder,
  source: TopoDS_Shape,
  relations: ReadonlySet<HistoryRelation>,
  stats: OcctHistoryStats,
) {
  stats.sourceCount += 1

  if (relations.has("modified")) {
    const count = readRelationCount(builder.Modified(source))
    stats.modifiedRelationCount += count
    stats.modifiedSourceCount += count > 0 ? 1 : 0
  }

  if (relations.has("generated")) {
    const count = readRelationCount(builder.Generated(source))
    stats.generatedRelationCount += count
    stats.generatedSourceCount += count > 0 ? 1 : 0
  }

  if (relations.has("deleted") && builder.IsDeleted(source)) {
    stats.deletedSourceCount += 1
  }
}

function captureTopologyHistory(
  opencascade: OpenCascadeInstance,
  builder: HistoryBuilder,
  sources: TopoDS_Shape[],
  topology: keyof Pick<
    TopAbs_ShapeEnum,
    "TopAbs_VERTEX" | "TopAbs_EDGE" | "TopAbs_FACE" | "TopAbs_SOLID"
  >,
  relations: HistoryRelation[],
) {
  const topologyType = opencascade.TopAbs_ShapeEnum[topology] as TopAbs_ShapeEnum
  const shapeType = opencascade.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
  const relationSet = new Set(relations)
  const stats = createHistoryStats()

  for (const source of sources) {
    const explorer = new opencascade.TopExp_Explorer_2(source, topologyType, shapeType)
    // These hashes deduplicate explorer occurrences only within one evaluation.
    const seen = new Set<number>()

    try {
      while (explorer.More()) {
        const current = explorer.Current()

        try {
          const hash = current.HashCode(2_147_483_647)

          if (!seen.has(hash)) {
            seen.add(hash)
            captureSourceHistory(builder, current, relationSet, stats)
          }
        } finally {
          current.delete()
        }

        explorer.Next()
      }
    } finally {
      explorer.delete()
    }
  }

  return stats
}

export function captureOcctBooleanHistory(
  opencascade: OpenCascadeInstance,
  builder: HistoryBuilder,
  sources: TopoDS_Shape[],
): OcctBooleanHistory {
  const relations: HistoryRelation[] = ["modified", "generated", "deleted"]

  return {
    vertices: captureTopologyHistory(opencascade, builder, sources, "TopAbs_VERTEX", relations),
    edges: captureTopologyHistory(opencascade, builder, sources, "TopAbs_EDGE", relations),
    faces: captureTopologyHistory(opencascade, builder, sources, "TopAbs_FACE", relations),
    solids: captureTopologyHistory(opencascade, builder, sources, "TopAbs_SOLID", relations),
  }
}

export function captureOcctFilletHistory(
  opencascade: OpenCascadeInstance,
  builder: HistoryBuilder,
  source: TopoDS_Shape,
): OcctFilletHistory {
  return {
    vertices: captureTopologyHistory(opencascade, builder, [source], "TopAbs_VERTEX", [
      "generated",
    ]),
    edges: captureTopologyHistory(opencascade, builder, [source], "TopAbs_EDGE", ["generated"]),
    faces: captureTopologyHistory(opencascade, builder, [source], "TopAbs_FACE", [
      "modified",
      "deleted",
    ]),
  }
}
