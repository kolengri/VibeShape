# Sweep and Loft

Finish the source sketches before opening **Loft** or **Sweep** from the Model toolbar or command
palette. The task panel selects stable profile boundaries and authored path entities from the current
solved sketch display. It also includes profiles from hidden sketches without changing their visibility.
Editing excludes sketches after the feature in History to prevent forward dependencies.

Use **Create sketch** with an XY, XZ, or YZ origin plane, or select an existing datum plane's face in the
viewport before creating the sketch. Its History row opens the plane's edit task. A datum plane's
signed offset gives each section its explicit support frame.
Neither feature moves or rotates the source sketches to make a preview succeed.

## Loft

Add two to eight distinct closed, hole-free sections. The list order defines the loft; use the explicit
earlier, later, and removal actions to change it. **Ruled** selects straight interpolation between
sections. Hole correspondence is not supported in this version. Degenerate or incompatible sections
fail exact native preview instead of producing an approximate mesh.

## Sweep

Choose one closed profile, including its authored holes, then a saved path sketch and its analytical
line or circular-arc entities. Select the path start point explicitly. Changing path sketches clears
the selected curves and direction. The chosen entities persist in canonical ID order; the start point
owns traversal direction independently of that ordering.

The selected curves must form one open, connected, G1-continuous path. The profile origin must already
coincide with its start and the profile plane must be normal to the start tangent. The start picker
lists selected curve endpoints; an interior endpoint or the wrong end fails exact native preview.
Construction curves and unsupported curve types are excluded from the path picker.

## Lifecycle and automation

The preview is disposable and Apply remains disabled until the complete exact native preview is ready.
A failed preview leaves the task open for repair. Cancel removes the preview and preserves the committed
document. Apply creates one ordinary transaction; editing a History row retains the feature identity,
section order, profile boundaries, path direction, and authored part allocation. Undo/Redo and native
Save/Open use the shared document lifecycle. Each successful feature produces one independently owned
part available for selected-part STEP export and downstream features.

The paired local MCP tools `create_loft`, `update_loft`, `create_sweep`, and `update_sweep` stage the same
strict schema-backed records in an owned draft. Loft supplies ordered `sections` and `ruled`; Sweep
supplies `profile` and a durable `path` with its sketch ID, sorted unique entity IDs, and explicit start
point ID. Sketch support and external-reference owners must match the authoritative dependency and
topology-reference order. Fresh command IDs and current draft revisions, preview, and ordinary commit
are required; these tools add no document authority or automatic profile repositioning.
