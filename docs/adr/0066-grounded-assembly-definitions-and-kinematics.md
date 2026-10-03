# ADR-0066: Grounded assembly definitions and kinematics

- Status: Accepted domain contract; staged product integration
- Date: 2026-10-03
- Extends: [ADR-0054](0054-authored-parts-and-organizational-history-folders.md), [ADR-0060](0062-durable-source-assets-and-portable-closure.md)

## Context

An authored Part describes a body history. Repeated assembly occurrences need independent identity and
placement without duplicating that history or treating a disposable worker body as assembly authority.
A bounded static joint model also needs a precise frame convention before persistence, selection,
rendering or source resolution can use it.

## Decision

Define strict version-1 assembly, definition, occurrence and joint schemas in the pure domain package.
Definitions select an ordered, nonempty list of immutable source pins. A Part pin captures the Part ID,
exact producer/output-role body reference and content hash; an imported-output pin captures the source
asset ID, authored output ID and digest. There are no ordinal geometry identities. Definition and
occurrence UUIDv7 identities are independently authored and cannot reuse selected source identities.
Many occurrences may reference one definition; each occurrence has its own stable UUIDv7 identity.

Pins are declarations, not proof that their source exists or still matches. Integration must resolve a
Part pin against an immutable geometry snapshot with the captured body and content identity. Looking
up an unchecked live Part tip is insufficient. Asset pins require the matching immutable descriptor,
output and verified source bytes. Missing, stale or mismatched pins must fail explicitly rather than
silently change the occurrence geometry. This leaf contract adds no document or archive migration.

Use rigid poses with millimeter translation and quaternion order `[x, y, z, w]`. Rotations are active,
right-handed, and quaternion multiplication composes the right operand first. Finite quaternion and
axis directions require a finite norm of at least `1e-12` and are normalized. Quaternions choose the
sign whose first nonzero component in `[w, x, y, z]` is positive; equivalent `q` and `-q` have one
representation. Signed zero is canonical positive zero. Joint axes retain their authored direction.
Nonfinite values, zero or negligible directions, extra fields and unsupported versions are rejected.
Directions already within `1e-15` of unit norm retain their values so repeated schema reads are
idempotent rather than changing immutable pose content by a floating-point rounding step.

Joints form a directed forest. Every root is grounded by an explicit world frame. Every other
occurrence has exactly one incoming joint and no independent world-frame authority. Missing
definitions or endpoints, self joints, duplicate identities, multiple incoming constraints, grounded
children, floating roots and cycles are rejected with explicit diagnostic codes. Fixed joints have no
drive. Revolute drives use radians and prismatic drives use millimeters along an explicit axis in the
parent joint frame. Both have finite, ordered, inclusive limits; drives outside their limits fail and
are never clamped. No dynamics, collision response or closed-loop constraint solving is implied.

The child occurrence frame is:

```text
worldChild = worldParent * parentJointFrame * drive * inverse(childJointFrame)
geometryFrame = worldOccurrence * inverse(definition.sourceFrame)
```

`sourceFrame` identifies the definition frame expressed in the original selected source coordinates.
The returned `geometryFrame` maps those original source coordinates into assembly world coordinates.
All selected sources in a definition share that source coordinate system. Parent frame, drive and
child inverse compose as rigid transforms; translation-only inversion is incorrect for rotated frames.

Bound the document to 256 definitions, 256 occurrences, 255 joints, 256 pins per definition and 4096
pins in total. Every authored translation component lies within `+/-100000` mm. Revolute values and
limits lie within `+/-2*pi` radians; prismatic values and limits lie within `+/-100000` mm. Evaluation
also checks the final occurrence and transformed source origins against the world coordinate budget.
Only composed translations may canonicalize an outward rounding error of at most `1e-9` mm to the
closed coordinate boundary; authored translations retain strict bounds.
Intermediate joint-frame origins may cancel during composition and are not independent world poses.
These checks do not prove native geometry extents or physical fit; integration must validate those
against the resolved source geometry.

Evaluation is pure and deterministic: roots and children use ASCII UUID order, a breadth-first queue
records parent-before-child evaluation, and returned occurrence poses use UUID order. A failure returns
one structured diagnostic with at most 16 issue details and no partial pose collection. Inputs remain
unchanged. The empty initial assembly has a valid empty solution.

## Consequences and evidence

- Definitions, source pins and occurrences remain distinct from authored Part ownership.
- Tests check strict schema versions, immutable ordered pins, normalization, direction preservation,
  count budgets, grounded forests, missing references, redundant constraints and cycles.
- Mathematical fixtures check active handedness, noncommuting quaternion composition, offset hinge
  pivots, rotated prismatic axes, full frame inversion and source-to-world transforms.
- A 256-occurrence chain, deterministic reorderings, closed drive limits, composed world-budget
  failures and unchanged inputs exercise the bounded solver.
- Persistence, captured commands, source snapshot resolution, worker geometry, assembly UI and
  imported-source availability remain integration work; this domain slice does not claim those flows.
