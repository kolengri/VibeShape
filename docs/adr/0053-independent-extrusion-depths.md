# ADR-0053: Independent extrusion depths

- Status: Accepted
- Date: 2026-10-03
- Extends: [ADR-0019](0019-selector-backed-new-body-extrusion.md), [ADR-0034](0034-versioned-multi-profile-feature-input.md), [ADR-0036](0036-multi-profile-modifying-extrusion.md)

## Context

Saved Extrude versions 1–4 describe one positive distance and a symmetric flag. Symmetric distance is
the **total** span, with half on each side of the sketch reference plane. Independent depths and a
direction flip must remain parametric without reinterpreting old documents, introducing an offset
plane, or persisting derived geometry.

## Decision

Introduce `org.vibeshape.feature.part-design.extrusion#5`. Its strict persisted parameters are:

- one canonical same-sketch `SketchProfileSet`, containing one or more profiles;
- authored length `distance`, retaining its literal unit or expression;
- `symmetric` and `reversed` booleans;
- nullable authored length `secondDistance`; `null` disables the second side;
- operation `new`, `add`, `remove`, or `intersect`.

Each enabled depth must resolve to a finite value between 0.001 and 100,000 mm. The combined span
must be at most 100,000 mm. Symmetric extrusion requires `secondDistance: null`; its distance retains
the total-span meaning. Invalid authored or resolved depths fail validation without clamping.

Reference-normal bounds are deterministic:

| Mode | Start | End |
| --- | --- | --- |
| Forward, one side | 0 | distance |
| Reversed, one side | -distance | 0 |
| Forward, two sides | -secondDistance | distance |
| Reversed, two sides | -distance | secondDistance |
| Symmetric, either direction | -distance / 2 | distance / 2 |

The sketch reference plane remains fixed. Direction flip exchanges the physical side assigned to
each authored depth. It has no geometric effect on a symmetric span.

Versions 1–4 keep their strict schemas, bounds, content identities, and saved values. Runtime reads
normalize their missing direction and second side to `reversed: false` and `secondDistance: null`
without rewriting the persisted record. Creating or explicitly editing advanced extent intent uses
version 5 through the ordinary feature command, portable history, and native-file contracts.

The document worker resolves every selected profile in canonical order after one sketch solve and
prepares bounded analytical content containing both resolved depths. The geometry worker constructs
the existing exact OCCT prism from the physical start to end. Multi-profile tools retain canonical
combination and explicit target-first Boolean semantics. New results admit up to the selected profile
count of positive-volume solids; modifying results require exactly one valid positive-volume solid.
Single-profile New results remain ordinary modifying targets. Multi-profile New results retain the
existing aggregate-target restriction.

`extrusion.cap.start` and `extrusion.cap.end`, including attached edge and vertex roles, follow
increasing physical reference-normal coordinates. Support-frame fallback and kernel topology use
the same numeric extent calculation. Role identity never depends on OCCT face or edge order.

## Consequences

- Independent expressions rebuild both depths through the existing variable and command owners.
- Preview, commit, undo, redo, replay, and reopen preserve authored extent intent and feature identity.
- A legacy symmetric depth of 10 mm remains a span from -5 to +5 mm.
- Worker restart derives the same geometry from bounded semantic inputs.
- UI and MCP adapters expose the same registered feature contract; neither owns an alternate kernel path.
- Starting offsets, arbitrary extrusion directions, taper, and end conditions remain outside this change.

## Verification gates

Focused domain and protocol tests cover malformed extents, units and expressions, resolved overflow,
strict version compatibility, same-sketch profile sets, target ownership, and deterministic prepared
content. Geometry acceptance requires real worker evidence for 10 mm forward plus 3 mm backward,
flip, legacy symmetric bounds, positive volume, cap roles, multiple profiles, modifying operations,
rebuild, and disposal. Integrated browser, file/history, and independent review evidence remains the
primary agent's acceptance responsibility.

## Integrated evidence

The controlled OCCT worker matrix passed in Chromium, Firefox, and WebKit. It verifies independent
10/3 mm depths, reverse, legacy and V5 symmetric spans, multi-profile solids, all three modifying
operations, expression rebuild, physical cap roles, worker restart, and zero live handles after
disposal. For a 20 by 10 mm profile, the two-sided result has volume 2,600 cubic mm and bounds
from -3 to 10 mm along its normal.

A real MCP session creates reversed 10/3 mm intent, the user changes the first depth to 13 mm,
and MCP changes only the second depth to 7 mm after reading the current feature. All three browsers
preserve 13/7 mm, reversal, and the resulting 4,000 cubic mm volume through reload. Pointer tests
cover both depth controls, angled and zoomed views, Escape, capture loss, and tool closure during a
pending preview. The 93-case affected CAD baseline passes across all three browsers. Independent
review of the integrated kernel, UI, and MCP paths found no actionable defects.

The separate File workflow increment adds a native Save/Open-copy browser journey for this intent;
that workflow is not part of the evidence above.
