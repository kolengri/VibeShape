export function createKernelSpikeParameters() {
  return {
    boxSize: [60, 40, 20] as [number, number, number],
    cylinderRadius: 8,
    cylinderHeight: 30,
    cylinderOrigin: [0, 0, -5] as [number, number, number],
    filletRadius: 1.5,
    meshTolerance: 0.05,
    angularTolerance: 0.1,
    lifecycleIterations: 3,
  }
}

export const kernelSpikeExpectedInvariants = {
  minimumVolume: 40_000,
  maximumVolume: 48_000,
  minimumFaceCount: 7,
  minimumEdgeCount: 15,
  maximumRelativeStepVolumeError: 1e-6,
  minimumStepBytes: 1_000,
  minimumBinaryStlBytes: 84,
} as const
