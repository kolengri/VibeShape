# Print readiness and radial fit allowance

Local/development MCP, paired remote MCP and the connected browser assistant expose
`analyze_print_readiness`. Start with `model_info`, retain the saved `revision`, and explicitly
supply `rotationX`, `rotationY` and `rotationZ` in degrees. These describe the print copy, applied
X then Y then Z; the operation does not read or change the editor camera or authored placement.
Use zeroes only when the user intends the current model's Z-up orientation. Ask for the intended
print orientation when it materially affects the answer and is unknown.

`minimumWallMm` defaults to 0.8; `overhangAngleDeg` defaults to 45 degrees from vertical. The host
seats the shared lowest point on the bed, excludes bed-contact triangles, and checks centroid
inward-ray thickness and downward face normals. It returns compact per-body triangle counts,
sampled thin/overhang areas in mm2, minimum sampled thickness in mm, topology and unknown coverage.
No meshes, source bytes, document writes, drafts or History changes are returned or created.

Report `unknown` explicitly. Open, reversed, degenerate or over-budget meshes never establish
readiness; an over-budget source may leave every body unknown. `no-findings` means only that the
measured samples did not cross the requested thresholds. Small features between samples and
self-intersections can be missed. Never call this a proof of minimum wall thickness, slicer
acceptance, printer calibration or physical printability. Changed revision/geometry cancels the
result; reconcile `model_info` before retrying. Respect explicit cancellation rather than polling
or starting concurrent duplicate analyses.

For shared fit clearance, use the ordinary variable draft tools to create/update a nonnegative
length named `tolerance`, preview and commit normally. Example radial allowances are 0.1, 0.2 and
0.3 mm; they require user/printer calibration. Hole diameter compensation is twice the radial
allowance (`4 mm + 2 * #tolerance`), while Thread radial `clearance` is `#tolerance`. Preserve
existing feature quantities unless the requested edit explicitly links them. `model_variables`
and `model_variable_usage` reveal saved definitions and their consumers; a label alone is not a
stable variable ID. See the [product contract](https://github.com/kolengri/VibeShape/blob/main/docs/product/print-readiness.md).
