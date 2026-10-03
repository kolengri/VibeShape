# ADR-0070: Immutable font intent and exact sketch text outlines

- Status: Accepted headless contract; sketch command, persistence and interaction integration are separately verified
- Date: 2026-10-03
- Extends: [ADR-0066](0068-exact-cubic-bezier-sketch-curves.md)

## Decision

Editable sketch text captures its NFC text, immutable font ID and SHA-256 digest, pinned static face
metrics, outline SDK version and layout policy. Height is in millimeters and means the OS/2 capital
height, not the font em square or the particular string's ink bounds. Tracking, pair kerning and both
alignment axes are explicit. Baseline alignment uses font Y-up coordinates; bottom, center and top
alignment use analytical ink bounds. Horizontal alignment uses the typographic advance including
entered spaces. Negative tracking is permitted and may produce intersecting outlines; the usual
sketch profile validation remains authoritative for solid operations.

The first font is the unchanged static Noto Sans Regular revision 2.008 from the pinned official
Noto source. Its original bytes, full SIL OFL 1.1 license and source/digest provenance are bundled in
`packages/formats/src/text-outline/fonts`. No remote URL, uploaded font, operating-system font or
fallback face is accepted. An edit or rebuild verifies the exact byte length and SHA-256 before
using a bounded private parsed-font cache. The owned byte copy is made before asynchronous hashing.
Absent capital-height metrics or other pinned metric mismatches fail instead of inferring scale.

OpenType.js 2.0.0 is the zero-dependency MIT browser SDK. The saved algorithm is
`unicode-scalar-kerning-v1`: map each Unicode scalar directly to its glyph index, then apply supported
pair kerning and explicit tracking. Do not invoke the SDK's GSUB text-shaping path; its contextual
substitution support cannot shape this face reliably. A sequence such as `fi` retains two scalar
glyphs. Basic Latin, Greek and Cyrillic are supported, with common punctuation and symbols subject
to actual face coverage. NFC normalization preserves scalar order, case and spacing. Surviving
combining marks, controls, multiline text, joiners and scripts requiring other shaping policies fail
with an explicit diagnostic. Glyph index zero fails as a missing glyph; no replacement character,
silent character omission or substitute font is used.

The formats leaf returns exact, closed contours as lines and cubic Bezier segments without UUIDs.
Native quadratic glyph curves are exactly degree-elevated to cubics. Font composite glyph outlines
come from the SDK's TrueType reader; no sampled polyline, raster tracing or hinting approximation
becomes geometric authority. Contour winding and holes are preserved. Bounds come from cubic
derivative extrema. Glyph-run positions, advance, baseline and face-scaled metrics accompany the
outlines. Coordinates and control poles must be finite and within +/-100,000 mm.

The request is limited to 64 NFC Unicode code points, 2,000 outline segments and 2,000 poles across
all glyphs. A line accounts for two poles and a cubic for four, conservatively counting repeated
endpoints. Aggregate limits are checked before appending each curve. Empty ink, missing glyphs,
malformed contours, mismatched resources and budget failures return no partial outline set. Original
parameters and font bytes remain owned by their caller; result curves and metadata are fresh values.

The domain intent is independent of React, font parsing, persistence and the geometry adapter.
`@vibeshape/formats/text-outline` accepts explicitly supplied bundled bytes and performs no IO.
The static TTF has an explicit package asset export for the existing Vite asset pipeline. Library
types introduce neither Node globals nor DOM canvas requirements; headless test IO stays inside the
test runner. WebCrypto SHA-256 is a required worker capability.

## Identity and integration boundary

An ordinary sketch command allocates captured point and line/cubic entity UUIDs for these contours.
Editable text groups retain the complete intent and captured outline ownership so a text edit can
regenerate its owned curves through the normal draft and Undo/Redo mechanisms. The immutable font
and layout metadata are needed in addition to flattened curves; saved intent cannot select whatever
font happens to exist later. The leaf allocates no persistent geometry identity and does not modify
the shared SketchRecord contract, command journal or UI.

Leaf tests and a browser worker prove the outlined geometry and resource boundary. Product text
authoring, restart, group editing, Undo/Redo, actual profile extraction and exact native extrusion
remain integration acceptance. This contract adds no advanced shaping, variable-font axes, dynamic
font installation, manufacturing or external text-rendering equivalence claim.
