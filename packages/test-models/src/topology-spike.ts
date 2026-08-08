export interface TopologySpikeFixtureParameters {
  boxSize: [number, number, number]
  holeCount: number
  holeRadius: number
  holeSpacing: number
  holeCenter: [number, number]
  filletRadius: number | null
}

export interface TopologySpikeScenario {
  name: string
  parameters: TopologySpikeFixtureParameters
  missingBaselineRoles: string[]
}

export const topologySpikeBaselineRoles = [
  "base-extrude.cap.start",
  "base-extrude.cap.end",
  "base-extrude.side.x-min",
  "base-extrude.side.x-max",
  "base-extrude.side.y-min",
  "base-extrude.side.y-max",
  "pattern.hole.negative.wall",
  "pattern.hole.positive.wall",
  "top-fillet.surface.x-min",
  "top-fillet.surface.x-max",
  "top-fillet.surface.y-min",
  "top-fillet.surface.y-max",
] as const

const baseline: TopologySpikeFixtureParameters = {
  boxSize: [60, 40, 20],
  holeCount: 2,
  holeRadius: 6,
  holeSpacing: 14,
  holeCenter: [0, 0],
  filletRadius: 1.5,
}

function scenario(
  name: string,
  overrides: Partial<TopologySpikeFixtureParameters> = {},
  missingBaselineRoles: string[] = [],
): TopologySpikeScenario {
  return { name, parameters: { ...baseline, ...overrides }, missingBaselineRoles }
}

const holeRoles = ["pattern.hole.negative.wall", "pattern.hole.positive.wall"]
const filletRoles = [
  "top-fillet.surface.x-min",
  "top-fillet.surface.x-max",
  "top-fillet.surface.y-min",
  "top-fillet.surface.y-max",
]

export const topologySpikeScenarios: TopologySpikeScenario[] = [
  scenario("baseline"),
  scenario("length increased", { boxSize: [72, 40, 20] }),
  scenario("width increased", { boxSize: [60, 48, 20] }),
  scenario("height increased", { boxSize: [60, 40, 28] }),
  scenario("hole radius increased", { holeRadius: 8 }),
  scenario("pattern crosses the origin", { holeCenter: [2, 1] }),
  scenario("fillet radius increased", { filletRadius: 2.5 }),
  scenario("pattern count increased", { holeCount: 3 }),
  scenario("pattern count reduced to seed", { holeCount: 1 }, holeRoles),
  scenario("hole feature suppressed", { holeCount: 0 }, holeRoles),
  scenario("fillet feature suppressed", { filletRadius: null }, filletRoles),
  scenario("upstream features restored"),
]
