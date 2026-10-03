# Editable sketch text

Text in an active sketch opens a parameter dialog. Enter a single line, capital height, letter
spacing, kerning, horizontal and vertical alignment, and the origin in the existing sketch frame.
Height and coordinates are explicitly in millimeters. The bundled immutable Noto Sans Regular face
supports Latin, Greek and Cyrillic under the saved scalar-and-kerning layout policy; unsupported
shaping, combining marks and missing glyphs fail with an actionable diagnostic. No uploaded,
operating-system or remote font is selected.

Apply prepares exact closed line and cubic Bezier contours using the pinned local font, verifies
its resource binding, and publishes one ordinary sketch draft edit. It allocates the group and
outline identities only after successful preparation. Duplicate Apply is blocked while pending;
failed preparation releases Apply for retry. Cancel, including during preparation, discards the
operation without changing the draft. A changed sketch requires reopening the dialog. Finish sketch
uses the existing authored save and document history flow.

The Text groups section restores each group's saved parameters for editing. Apply preserves the
group UUID and regenerates all of its owned outline UUIDs atomically. A hash mismatch warns that
manual curve edits will be replaced. Attached constraints require an explicit removal checkbox;
unrelated geometry and constraints remain in the sketch. Detach to curves removes only editable
text metadata and preserves the existing curves and constraints. Apply and Detach each have one
sketch Undo step.

Native Save/Open retains font intent, origin, owned curve and point UUIDs, and the outline digest.
The outlines participate in ordinary solving, profile extraction and exact extrusion. Intersecting
glyphs or negative spacing may still fail ordinary profile validation. The workflow makes no
advanced shaping, substitute-font, physical manufacturing or external-renderer equivalence claim.

The bundled font's SIL OFL license and provenance remain in
`packages/formats/src/text-outline/fonts`; the outline SDK's MIT notice remains alongside the
formats implementation. Distribution packaging owns their notices. See
[ADR-0070](../adr/0070-immutable-font-sketch-text-outlines.md) for the immutable resource and layout
contract, and [ADR-0068](../adr/0068-exact-cubic-bezier-sketch-curves.md) for exact cubic authority.
Product browser acceptance and integrated review remain separate from form and headless tests.
