# ADR-0128: Saved authored-part appearance

- Status: Accepted
- Date: 2026-10-22
- Extends: [ADR-0054](0054-authored-parts-and-organizational-history-folders.md),
  [ADR-0056](0056-bounded-authored-metadata-automation.md),
  [ADR-0103](0103-retained-history-repair-authority.md)

## Decision

Document authority V6 adds `partAppearances`, a bounded collection of unique authored `PartId`
assignments. Each value contains a stable visual `presetId` or `null` for the ordinary material,
and an optional validated `#RRGGBB` color override. The collection references active or suspended
parts. It contains no physical density, mass, manufacturing certification, renderer handles, or
localized display names. Historical PartRecord v0 and document V2–V5 schemas remain unchanged.

The domain owns twelve visual presets: Aluminum Satin, Steel Brushed, Stainless Steel, Brass,
Copper, Chrome, Anodized Black, ABS White, ABS Black, ABS Grey, Polycarbonate Clear, and Nylon Natural.
Stable IDs map to sRGB display color, roughness, metalness, and opacity. The UI owns ICU labels.

The revision-checked V6 metadata command `part.set-appearance` replaces one complete appearance
value. `appearance: null` resets the part to its ordinary presentation. A color edit supplies the
current preset ID, preserving its shading properties. A preset edit omitting `color` clears the
override. `presetId: null` supports a custom color with the ordinary shading properties.

The first appearance command adopts authored V2–V5 authority and applies the value atomically in
one revision, event, storage transaction, and Undo boundary. Empty intervening texture, source, and
repair collections may be adopted at that same revision. V6 wraps ordinary authored/model events
and prunes assignments only when their PartIds cease to exist. Modifier changes, retargeting,
suppression, consumption, and retained-History repair preserve appearance through stable part
identity. A V6 restore restores complete appearance and model state; restoring an older target
retains V6 authority with an empty appearance collection.

## Persistence and native files

The existing IndexedDB stores gain strict V6 head, snapshot, event, and recovery variants, without
a database/store migration. Heads record `appearanceUpgradeRevision`. Unsupported head versions
fail before corruption fallback, and recovery cannot cross the committed appearance boundary.
Saved Undo/Redo navigation survives adoption and continues to reference verified historical targets.

Native format 7 carries V6 authority, adoption boundaries, complete mixed history, and historical
source-asset closure. Existing formats 0–6 keep their strict parsers. Older readers reject format 7
through its manifest/minimum-reader version. Imports and copies use existing replay validation and
identity remapping; document-local PartIds and their appearance values remain intact.

## Presentation boundary

The host resolves current semantic body bindings, including `outputRole`, and projects material
data and color onto viewer meshes. The viewer does not assign part identity or mutate authority.
An appearance-only update changes the existing owned material in place, including transparency and
depth-write state, while reusing equal geometry and prepared edges. Removing or replacing a body
disposes its owned materials exactly once. Shared preview/datum materials remain separately owned.

Appearance authoring is an editor metadata capability in this increment. Existing MCP metadata,
texture, assembly, and History operations continue to preserve V6 state; this does not add an MCP
appearance tool or extend the historical `change_metadata` input schema.

## Validation

Domain tests cover strict color/preset data, V2–V5 adoption, complete-value replacement, stale and
missing targets, replay, and restore across adoption. Session/controller tests cover one-save
publication, failure retention, ordinary model edits, Undo/Redo, and reopen. Storage tests cover
checksums, head dispatch, replay from an older checkpoint, and refusal to fall back before adoption.
Native tests cover round-trip/copy and missing or forged provenance alongside the older format
corpus. Renderer tests assert output-role isolation, in-place shading changes, geometry/edge reuse,
and disposal ownership.
