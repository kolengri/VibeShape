# Mechanical design

Use this guidance for functional parts, load-bearing details, fits, and mechanisms, whether printed or manufactured another way. Combine it with [3D-printing design](3d-printing.md) only when printing is intended.

## Loads and transitions

Identify where loads enter and react, and which sections bend, peel, or twist. Prefer rounded transitions over sharp corners where feasible and consistent with the task, especially at internal corners, section changes, and the roots of load-bearing ribs, brackets, pins, and snap arms, to reduce stress concentrations.

Choose radii that preserve required dimensions, mating surfaces, clearances, and remaining load-bearing sections; retain sharp edges when their function requires them. Use supported profile arcs or scoped Fillet features with named radius variables. Inspect exact preview and critical sections after treatment. Successful geometry alone does not establish strength or fatigue life.

## Fits and movement

Keep accepted contact geometry and the provenance of critical dimensions explicit. Distinguish running clearance, intentional contact, and elastic interference. Inspect the insertion/removal path, retention, and tool access rather than checking only the final assembled pose. Avoid changing a retaining shoulder or datum merely to simplify construction.

For flexible mechanisms, separate a geometric deformation or clearance check from an elasticity or cycle-life claim. Use applicable material/process data, a justified calculation, or physical evidence for structural acceptance; do not infer it from a render.
