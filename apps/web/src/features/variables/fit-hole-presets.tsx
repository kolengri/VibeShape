import {
  printFitClearance,
  printFitHoleExpression,
  type VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"

export function FitHolePresets({
  variables,
  disabled,
  onChoose,
}: {
  variables: readonly VariableDefinition[]
  disabled: boolean
  onChoose: (expression: string) => void
}) {
  const t = useTranslations("app.printFit")
  const available = printFitClearance(variables) !== null
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">
        {available ? t("holeDescription") : t("enableHint")}
      </p>
      <div className="flex flex-wrap gap-1">
        {[3, 4, 5, 6, 8, 10].map((diameter) => (
          <Button
            key={diameter}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !available}
            onClick={() => onChoose(printFitHoleExpression(diameter))}
          >
            {t("holePreset", { diameter })}
          </Button>
        ))}
      </div>
    </div>
  )
}
