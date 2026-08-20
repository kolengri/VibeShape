export const viewerOriginPlanes = ["xy", "xz", "yz"] as const

export type ViewerOriginPlane = (typeof viewerOriginPlanes)[number]
export type ViewerOriginPlaneVisibility = Readonly<Record<ViewerOriginPlane, boolean>>

export const defaultViewerOriginPlaneVisibility = {
  xy: true,
  xz: true,
  yz: true,
} as const satisfies ViewerOriginPlaneVisibility
