# Customizer

Open **Variables → Customizer**. Expand **Configure sliders**, expose the variables that a template
user should edit, assign groups and set finite minimum, maximum and positive step. Length ranges
use millimetres, angles use radians, and scalars have no unit. Apply the customizer changes to save
this setup in the editable design.

Adjust the sliders or numeric values, then apply once to rebuild the model. Dragging does not run
CAD jobs. A changed input becomes a literal expression; downstream variable and feature expressions
continue to follow it. Each apply is one ordinary Undo step and refuses stale revisions or read-only
sessions.

To save a variant, enter a configuration name and save the current configuration. This saves the
current values and slider settings together. Applying a named variant replaces every exposed value
in one transaction. Adding another exposed variable makes older configurations incomplete until
saved again. Configurations and groups travel in native `.vshape` files with the variable table.

Agents can inspect the variable table and preserve/edit each optional `customizer` object using
`replace_variable_table` in their ordinary draft. Metadata fields are `dimension`, `group`, `min`,
`max`, `step` and `configurations` (name to canonical numeric value). Retain stable variable IDs and
names, unrelated metadata and unexposed expressions. Applying a configuration must retain all
unrelated variables and pass normal preview/review/commit checks.
