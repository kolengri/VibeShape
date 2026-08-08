const boxTriangles: Array<[number, number, number]> = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [3, 7, 6],
  [3, 6, 2],
  [0, 4, 7],
  [0, 7, 3],
  [1, 2, 6],
  [1, 6, 5],
]

const thumbnail = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0,
  0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24,
  227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

function boxVertices(x: number, y: number, z: number): Array<[number, number, number]> {
  return [
    [0, 0, 0],
    [x, 0, 0],
    [x, y, 0],
    [0, y, 0],
    [0, 0, z],
    [x, 0, z],
    [x, y, z],
    [0, y, z],
  ]
}

const towerTransform: [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [1, 0, 0, 0, 1, 0, 0, 0, 1, 7, 3, 4]

export const threeMfInteroperabilityInvariants = {
  facetCount: 24,
  volumeCubicMillimeters: 1_608,
} as const

export function createThreeMfInteroperabilityDocument() {
  return {
    schemaVersion: 1 as const,
    metadata: {
      title: "VibeShape 3MF interoperability fixture",
      application: "VibeShape SPK-004",
      creationDate: "2026-08-08T00:00:00Z",
    },
    objects: [
      {
        kind: "mesh" as const,
        id: 1,
        name: "Base",
        partNumber: "VS-BASE-001",
        mesh: { vertices: boxVertices(20, 12, 4), triangles: boxTriangles },
      },
      {
        kind: "mesh" as const,
        id: 2,
        name: "Tower",
        partNumber: "VS-TOWER-001",
        mesh: { vertices: boxVertices(6, 6, 18), triangles: boxTriangles },
      },
      {
        kind: "components" as const,
        id: 3,
        name: "Interoperability assembly",
        components: [{ objectId: 1 }, { objectId: 2, transform: towerTransform }],
      },
    ],
    build: [{ objectId: 3, partNumber: "VS-BUILD-001" }],
    thumbnail: { mediaType: "image/png" as const, data: thumbnail },
  }
}
