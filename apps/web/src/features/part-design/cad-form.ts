import {
  createFormHook,
  formHookOptions,
  revalidateLogic,
} from "@vibeshape/ui/integrations/tanstack-form"
import {
  TanStackVariableExpressionField,
  TanStackVariableExpressionInput,
} from "../variables/tanstack-variable-expression-field"
import { TanStackLengthExpressionField } from "./length-expression-field"
import { TanStackReferencePickField } from "./tanstack-reference-pick-field"
import { TanStackSearchableSelectField } from "./tanstack-searchable-select-field"

export const { useAppForm: useCadForm } = createFormHook({
  ...formHookOptions,
  fieldComponents: {
    ...formHookOptions.fieldComponents,
    LengthExpressionField: TanStackLengthExpressionField,
    VariableExpressionField: TanStackVariableExpressionField,
    VariableExpressionInput: TanStackVariableExpressionInput,
    SearchableSelectField: TanStackSearchableSelectField,
    ReferencePickField: TanStackReferencePickField,
  },
})

export const cadFormValidationLogic = revalidateLogic()
