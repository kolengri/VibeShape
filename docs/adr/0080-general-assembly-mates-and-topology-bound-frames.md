# ADR 0080: General assembly mates and topology-bound frames

Status: Accepted

## Decision

Add assembly schema version 2 inside existing document V4 authority. Version 1 keeps the strict
grounded-forest schema and its existing algebraic solver from
[ADR-0066](0066-grounded-assembly-definitions-and-kinematics.md). Opening, saving and replaying a
version-1 project never upgrades it implicitly. The explicit `assembly.upgrade` mutation captures
the legacy solved world poses as version-2 initial poses and retains existing driven coordinates,
UUIDs, definition pins and source bytes. Undo restores the original version and forest semantics.

Version 2 admits multiple mates per occurrence, closed loops and multiple grounded occurrences.
It adds cylindrical and ball joints to fixed, revolute and prismatic joints. Ungrounded occurrences
author an `initialFrame`; that pose selects the local branch and seeds free motion. Revolute and
prismatic coordinates can be passive or driven. Cylindrical joints independently drive rotation
and translation. Every connected component needs an explicitly grounded occurrence. Floating
components fail rather than receiving an invented world anchor.

The pure domain validates authority and replays commands without geometry or numerical solving.
The application rebuilds and verifies complete immutable source pins before resolving mate frames.
The document worker invokes an injected `AssemblyConstraintSolvePort`. Inspection, exact
interference, exports and print preparation consume the same verified occurrence poses. UI
mutations preflight the proposed revision through a disposable worker before committing it.
Automation adapters must use the same preflight for version-2 changes. A structurally valid but
unsolved persisted graph remains readable and editable; materialization publishes no partial
occurrences. Document worker protocol version 25 transports solver diagnostics and local rank.

## Reuse the installed numerical core

Reuse the reviewed SolveSpace 3.2 flat WASM ABI from
[ADR-0014](0014-solvespace-flat-wasm-solver.md). Do not add a numerical engine, native rebuild, package,
paid service or mutable global solver session. The vendored public `slvs.h` does not expose native
assembly transformed-point entities. Its existing `solveFlatSystem` export does expose 3D points,
quaternion normals, moving workplanes, 2D points and the required geometric constraints.

Each moving body owns an origin and quaternion normal. The native quaternion norm equation leaves
six physical pose coordinates. A marker with local coordinates `(x, y, z)` uses fixed `(x, y)`
parameters on that body's moving workplane. For `z != 0`, a 3D marker has coincident projection onto
the workplane marker and signed point-plane distance `z`. These three equations exactly represent
the rigid transformed marker. Grounded markers are constants. Proper normalized quaternion poses
prevent reflection; no independently deformable tetrahedron approximates a rigid body.

Mate equations are:

| Mate | Passive equations | Nominal free coordinates |
| --- | --- | --- |
| Fixed | Coincident origins, oriented aligned axes and clocking | 0 |
| Revolute | Coincident origins and oriented aligned axes | 1 rotation |
| Prismatic | Coincident axis lines, oriented aligned axes and clocking | 1 translation |
| Cylindrical | Coincident axis lines and oriented aligned axes | 1 rotation, 1 translation |
| Ball | Coincident origins | 3 rotations |

Driving a passive coordinate adds its equality equation. Loops and repeated mates share occurrence
variables in one connected native system. The more constrained mates provide deterministic initial frame alignment;
passive coordinates retain the authored branch pose. Fully driven edges supply exact drive seeds;
they do not replace or skip the equations of redundant edges. Stable UUID sorting and persisted
initial poses make equivalent input orderings deterministic. Native SolveSpace solves synchronously
inside the document worker, so its singleton state is not accessed concurrently.

Native status 0 is converged and status 4 is redundant-consistent. Both require independently
checked oriented mate residuals, closed coordinate limits, finite poses and bounded world geometry.
Status 1 reports constraints inconsistent at the authored branch. Status 2 reports nonconvergence;
status 3 reports the native budget. The compiler conservatively limits each component to 1900
unknown parameters and 1900 constraint records below the native 2048 unknown limit. Failed native
handles map to stable mate UUIDs when the ABI supplies them. A redundancy flag does not invent a
per-mate conflict or redundancy set when that evidence is absent.

## Topology-bound frames

An optional parent or child binding records the definition `pinRevision`, selected `BodyReference`,
source index, durable `TopoRef`, analytical frame recipe, origin hint, X direction and axis reversal.
No transient OCCT face index, mesh face ID, candidate ID or ambient document lookup is authority.
Bindings resolve only against the occurrence's verified immutable selected body. The existing
semantic-role, lineage and geometric-signature resolver must identify one candidate. Missing,
ambiguous, stale, incompatible or mesh evidence fails closed with the responsible mate UUID.

Supported recipes use planar-face normal, cylindrical-face axis, spherical-face center, circle or
arc center/normal, and vertex position. The origin hint is projected onto a plane or cylinder axis;
sphere, circle and vertex recipes use their exact center or position. X direction projected
perpendicular to Z determines a stable right-handed frame. Parallel X and Z are rejected. OCCT
analytical evidence is extracted in owned temporary adaptors and disposed after capture.

If a binding is present, the authored numeric frame is an offset from the resolved analytical
frame. In definition-local coordinates the result is
`inverse(sourceFrame) * analyticalFrame * numericOffset`. Numeric-only frames remain valid. Source
geometry placement is always `worldFrame * inverse(sourceFrame)`, applied once before publication.
Relinking a definition advances its pin revision and invalidates old bindings until explicitly
reselected; it never silently rebinds a mate to nearby geometry.

## Limits and evidence

This is a bounded local static constraint solver. Degrees of freedom are the Jacobian rank at the
solved branch; positive DOF can be intended passive joint mobility. Zero DOF does not prove a
globally unique configuration, and a singular pose can have a different instantaneous rank. No
random branch search, motion simulation, collision response or inequality optimization is added.
Passive limits are checked after solving, never clamped or treated as an active limit constraint.
If the current seed produces an out-of-limit pose, the user must change the initial pose or drives.

Invariant evidence includes actual WASM joint mobility, a closed four-bar loop with redundant
consistent constraints, conflicting mates, arbitrary signed 3D marker offsets, reordered input,
unanchored components, limits and warmed heap capacity. Actual OCCT evidence checks analytical
frames and exact interference with a nonzero source frame. Domain and worker tests cover explicit
upgrade, versioned replay/Undo, topology failure, atomic publication and disposal. Browser tests
exercise topology authoring, multiple mates, free mobility, failed preflight and reload using the
real worker. These checks do not claim global branch uniqueness or physical manufactured fit.

The existing SolveSpace runtime and its GPL-3.0-or-later licensing and corresponding-source bundle
remain unchanged. The additional TypeScript compiler and schema are part of the existing packages;
no new WASM asset or paid runtime is required.
