export const fdmFieldDefinitions = {
  radius: [2, "length"],
  depth: [10, "length"],
  width: [20, "length"],
  length: [20, "length"],
  diameter: [6, "length"],
  roofAngle: [45, "angle"],
  acrossFlats: [6, "length"],
  compliance: [1, "length"],
  slotWidth: [1, "length"],
  holeDiameter: [10, "length"],
  ribHeight: [0.3, "length"],
  ribWidth: [0.6, "length"],
  count: [6, "scalar"],
  outerDiameter: [14, "length"],
  innerDiameter: [10, "length"],
  slotLength: [15, "length"],
  clearance: [0.2, "length"],
  bossDiameter: [0, "length"],
  bossHeight: [0, "length"],
  wall: [2, "length"],
  height: [3, "length"],
  thickness: [0.4, "length"],
  bridgeCount: [2, "scalar"],
  bridgeWidth: [1, "length"],
  diameterStart: [3, "length"],
  diameterStep: [0.1, "length"],
  holeCount: [5, "scalar"],
  spacing: [8, "length"],
  margin: [4, "length"],
  originX: [0, "length"],
  originY: [0, "length"],
  originZ: [0, "length"],
} as const

export type FdmField = keyof typeof fdmFieldDefinitions

export const fdmToolFields = {
  web: ["thickness", "depth"],
  "corner-relief": ["radius", "depth"],
  "seam-groove": ["width", "depth", "length"],
  "teardrop-hole": ["diameter", "depth", "roofAngle"],
  "hex-seat": ["acrossFlats", "depth", "compliance", "slotWidth"],
  "crush-ribs": ["holeDiameter", "ribHeight", "ribWidth", "depth", "count"],
  "flexible-sleeve": [
    "outerDiameter",
    "innerDiameter",
    "length",
    "slotWidth",
    "slotLength",
    "count",
  ],
  "nut-pocket": ["acrossFlats", "depth", "clearance"],
  "insert-pocket": ["diameter", "depth", "clearance", "bossDiameter", "bossHeight"],
  "enclosure-joint": ["width", "length", "wall", "height", "clearance"],
  membrane: ["width", "length", "thickness", "bridgeCount", "bridgeWidth"],
  "calibration-coupon": [
    "diameterStart",
    "diameterStep",
    "holeCount",
    "spacing",
    "thickness",
    "margin",
  ],
} as const satisfies Record<string, readonly FdmField[]>

export type FdmToolKind = keyof typeof fdmToolFields

export const fdmToolKinds = Object.keys(fdmToolFields) as FdmToolKind[]

export const fdmOriginFields = ["originX", "originY", "originZ"] as const
