export const CONTROLLED_OCCT_SOURCE_REVISION = "bb368e271e24f63078129283148ce83db6b9670a"
export const FEATURE_CONTENT_HOST_API_VERSION = "0.1.0"
export const MODELING_TOLERANCE_POLICY_VERSION = 1
export const GEOMETRY_ADAPTER_ID = "org.vibeshape.geometry.replicad"
export const GEOMETRY_KERNEL_ID = "org.opencascade.occt"

const isControlledBuild = import.meta.env.MODE === "controlled-occt"

export const GEOMETRY_ADAPTER_VERSION = isControlledBuild ? "spike-controlled-1" : "spike-2"
export const REPLICAD_VERSION = "0.23.1"
export const REPLICAD_OPENCASCADE_VERSION = isControlledBuild
  ? `controlled-${CONTROLLED_OCCT_SOURCE_REVISION.slice(0, 12)}`
  : "0.23.0"

// The published custom WASM package does not expose the exact OCCT source revision.
export const OPENCASCADE_SOURCE_REVISION: string | null = isControlledBuild
  ? CONTROLLED_OCCT_SOURCE_REVISION
  : null
