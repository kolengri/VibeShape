# ADR-0029: Exact bounded elliptical-arc point locus

Status: Accepted

## Context

VibeShape already represents an elliptical arc as one analytical ellipse plus stable center, axis,
start, and end point identities. The existing exact Point on ellipse constraint is insufficient for an
elliptical arc because it admits the complementary branch. Display samples, transient SVG segments,
or nearest sampled points cannot define persistent parametric intent.

SolveSpace has no native bounded ellipse-locus constraint. The existing reviewed adapter models a
full ellipse with an exact trammel construction, but that construction alone cannot preserve the
positive parameter sweep between the authored arc endpoints.

## Decision

Add a distinct `point-on-elliptical-arc` semantic constraint with one point identity and one
elliptical-arc identity. It is not an alias for `point-on-ellipse`.

Compile one authored constraint to the existing five-equation exact ellipse trammel plus one private
bounded-branch equation. For ellipse point `P`, start `S`, end `E`, and the sign `o` of the ordered
primary/secondary axis basis, define:

```text
H = cross(E - S, P - S)
oH + q² = 0
```

`q` is one solver-private slack parameter. For the stored positive elliptical parameter sweep, the
selected branch is exactly the side where `oH <= 0`; the complementary branch has the opposite sign.
The native adapter allowlists one project-owned constraint type, `100038`, for this equation. Its
point/entity references and scalar fields are validated by the same flat ABI boundary as upstream
SolveSpace records. All six native equations map back to the single authored constraint identity.

Compilation seeds boundary and complementary-branch guesses a small deterministic parameter step
inside the selected sweep so the squared-slack equation does not start with a zero derivative. After
every native solve, the application recomputes the solved eccentric-anomaly parameters from the exact
analytical axes and fails the authored constraint closed if the point is outside the current positive
sweep or the arc degenerates.

Passive inference and direct selection use the same semantic constraint for authored and materialized
external elliptical arcs. External identity remains the stable source selector, one projected curve ID,
and five role-ordered projected point IDs. No renderer identity or display sampling enters persistence.

## Consequences

- Point placement can infer against minor, major, wrapped, rotated, and axis-inverted elliptical arcs.
- Endpoint or axis edits preserve the intended bounded branch through stable entity identities.
- The promoted WASM runtime and corresponding-source archive must be rebuilt whenever this native
  equation changes.
- Nearly closed arcs remain guarded by exact post-solve parameter validation rather than relying only
  on the numerically short endpoint chord.
- Endpoint coincidence remains a separate semantic relation; inference precedence should prefer the
  endpoint identity when both endpoint and perimeter candidates are within tolerance.

## Rejected alternatives

- **Reuse Point on ellipse:** admits the complementary arc and loses bounded intent.
- **Persist sampled-polyline proximity:** changes with display tessellation and cannot survive edits.
- **Use transient native entity indices:** violates stable document identity and worker replay.
- **Implement only a visual preview:** presents an inference that cannot be preserved by the solver.

