import type { FdmFeatureParameters } from "@vibeshape/domain/part-design-fdm"
import {
  FdmCalibrationCouponIcon,
  FdmCornerReliefIcon,
  FdmCrushRibsIcon,
  FdmEnclosureJointIcon,
  FdmFlexibleSleeveIcon,
  FdmHexSeatIcon,
  FdmInsertPocketIcon,
  FdmMembraneIcon,
  FdmNutPocketIcon,
  FdmSeamGrooveIcon,
  FdmTeardropHoleIcon,
  FdmWebIcon,
} from "@vibeshape/ui/components/icons"
import type { ComponentType, SVGProps } from "react"

const icons: Record<FdmFeatureParameters["kind"], ComponentType<SVGProps<SVGSVGElement>>> = {
  web: FdmWebIcon,
  "corner-relief": FdmCornerReliefIcon,
  "seam-groove": FdmSeamGrooveIcon,
  "teardrop-hole": FdmTeardropHoleIcon,
  "hex-seat": FdmHexSeatIcon,
  "crush-ribs": FdmCrushRibsIcon,
  "flexible-sleeve": FdmFlexibleSleeveIcon,
  "nut-pocket": FdmNutPocketIcon,
  "insert-pocket": FdmInsertPocketIcon,
  "enclosure-joint": FdmEnclosureJointIcon,
  membrane: FdmMembraneIcon,
  "calibration-coupon": FdmCalibrationCouponIcon,
}

export function FdmToolIcon({
  kind,
  ...props
}: SVGProps<SVGSVGElement> & { kind: FdmFeatureParameters["kind"] }) {
  const Icon = icons[kind]
  return <Icon {...props} />
}
