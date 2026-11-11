import { useTranslations } from "@vibeshape/i18n"
import type { HelixFieldsCopy } from "./helix-fields"
import type { HelixValidationCopy } from "./helix-form-model"

/** Shared helix copy for Coil and the helical Sweep path. */
export function useHelixFieldsCopy(): HelixFieldsCopy & HelixValidationCopy {
  const t = useTranslations("app.helix")
  return {
    axis: t("axis"),
    axisDescription: t("axisDescription"),
    handedness: t("handedness"),
    right: t("right"),
    left: t("left"),
    radius: t("radius"),
    radiusDescription: t("radiusDescription"),
    pitch: t("pitch"),
    pitchDescription: t("pitchDescription"),
    extent: t("extent"),
    extentTurns: t("extentTurns"),
    extentHeight: t("extentHeight"),
    turns: t("turns"),
    turnsDescription: t("turnsDescription"),
    height: t("height"),
    heightDescription: t("heightDescription"),
    startAngle: t("startAngle"),
    startAngleDescription: t("startAngleDescription"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    missingAxis: t("missingAxis"),
  }
}
