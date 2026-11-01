# Scripts and macros

Open **Application menu → Scripts and macros…** in an editable project. **Load loop example**
loads TypeScript that creates three independent spheres using a typed loop and `Math.sqrt`.
**Run and preview** executes it in an isolated interpreter and validates geometry without saving.
Inspect the item counts, variable renames and source, then **Apply recipe** to append the result.
One ordinary Undo removes the complete replay. Editing source or changing the design invalidates
the preview; run it again before applying. **Cancel preview** terminates disposable work.

**Export design as script** writes the current supported modeling history and parameters as a
self-contained TypeScript recipe. **Download .ts** saves the current source, including edits.
TypeScript is transpiled, not typechecked: errors in output are caught by the recipe and geometry
validators. Scripts must `export default` a `vibeshape.recipe` v1 object; exported source and the
loop example show the schema. There are no browser, filesystem, network, time or random APIs, and
imports are unavailable. Source, output, memory and runtime are bounded.

To record a macro, select **Start recording**, model using ordinary editor tools, then reopen
**Scripts and macros…** and select **Stop recording**. New surviving History identities are
captured even if inserted before older items. Referenced earlier sketches and features are copied
with their dependencies and variables, so replay produces independent features. Updates to existing
items are not recorded. Stopping after an Undo with no surviving new items reports that nothing was
recorded. Switching projects invalidates the recording.

Replay preserves typed parameter values, expressions and Customizer metadata. Variable-name
collisions create suffixed copies and update expression references; destination display units stay
unchanged. Native `.vshape` remains the complete editable backup. Script export refuses unsupported
source assets/imports, topology-bound references, model-supported sketches, assemblies, textures,
custom part metadata, History folders and retained repair intent instead of silently omitting them.

Applied scripts become ordinary saved features. Source and recording state last only for the
current editor session; keep the downloaded `.ts` file. There is no persistent associative Script
feature, and source does not rerun when variables change or a project opens.

Paired local and remote MCP clients can request `export_design_recipe` with the exact current
revision. Its 128 KiB source limit is smaller than the editor's 2 MiB recipe budget. Run, preview,
recording and Apply are editor workflows; the MCP export does not execute code or save changes.
