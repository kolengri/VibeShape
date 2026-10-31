# ADR-0143: Exact mounting-point connection feature

Status: Accepted

## Decision

Extend the first-party Part Design owner with a versioned Connect Mounts solid feature. Its authored
parameters are captured model-coordinate points, node/strut radii in millimeters, and a tree or
complete connection policy. The domain owns schema validation, deterministic content identity and
registration. The geometry worker owns graph construction, exact sphere/cylinder fusion, shape
validation and native resource disposal. The UI and named MCP tools use the same feature command,
disposable preview and revision-safe commit authority.

Tree mode uses a deterministic minimum spanning tree. Complete mode joins every point pair.
A 16-point bound limits dense graph and Boolean construction cost. Neither mode claims to optimize
stress, stiffness, mass, manufacturing, obstacle routing or preservation of existing interfaces.
Numeric point snapshots do not create hidden source dependencies or transient topology identities.

## Alternatives and consequences

An SDF could provide smooth implicit blends and obstacle routing, but would introduce meshing and
exact-surface reconstruction tradeoffs. Existing exact primitive/Boolean infrastructure provides an
editable B-Rep and ordinary STEP export without a new computational dependency or worker protocol
operation. Tangential blends, actual mounting interfaces, obstacle avoidance and numerical
optimization remain future or separate downstream modeling operations.

The new feature schema is additive; existing documents require no migration. Geometry remains in
the worker and model data remains independent of React and the CAD adapter. Both local and paired
remote automation expose create/update over the registered feature path; the agent operator bundle
must describe the captured-coordinate semantics and approval boundaries in the same change.

Verification covers invalid and bounded inputs, deterministic normalization, exact solid invariants,
failure/resource behavior, MCP schema and command authority, task preview/readiness/editing, and a
real browser creation/commit workflow.
