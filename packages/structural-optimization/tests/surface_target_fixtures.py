"""Surface-target invariants shared by native Python and the pinned WASM suite."""

import json
import time

import numpy as np
import trimesh


def surface_request(mesh, support, load, iterations=0):
    return {
        "schemaVersion": 1,
        "mesh": {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0, "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2, "maxDisplacementMm": 1, "cellSizeMm": 1,
        "supports": [{"kind": "surface", "triangleIndices": support, "depthMm": 0.1}],
        "loadCases": [{"name": "axial", "region": {"kind": "surface", "triangleIndices": load, "depthMm": 0.1}, "forceN": [10, 0, 0]}],
        "preserveRegions": [], "maxIterations": iterations,
    }


def boundary_state(solver, request):
    source, origin, _ = solver._source(request, 1)
    cells = solver._voxelize(source, time.monotonic() + 180)
    mesh, nodes = solver._hex_mesh(cells, origin, 1)
    fixed, loads, protected = solver._conditions(request, mesh, nodes, cells, 1, source, time.monotonic() + 180)
    return source, origin, cells, mesh, nodes, fixed, loads, protected


def end_faces(mesh):
    return (np.flatnonzero(mesh.face_normals[:, 0] < -0.99).tolist(),
            np.flatnonzero(mesh.face_normals[:, 0] > 0.99).tolist())


def verify_rotated_surface_membership(solver):
    box = trimesh.creation.box(extents=[8, 6, 6])
    left, right = end_faces(box)
    box.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 6, [0, 0, 1]))
    request = surface_request(box, left, right)
    _, _, cells, mesh, nodes, fixed, loads, _ = boundary_state(solver, request)
    points = box.triangles[left].reshape(-1, 3)
    boundary_nodes = np.unique(mesh.facets[:, mesh.boundary_facets()])
    in_box = solver._within(mesh.p.T[boundary_nodes], (points.min(axis=0), points.max(axis=0)), 1e-9)
    box_keys = {tuple(point) for point in nodes[boundary_nodes[in_box]]}
    assert fixed < box_keys, "A rotated face must not clamp every node inside its AABB."
    assert len(cells) == 186 and len(fixed) == 39 and len(box_keys) == 62
    normal = box.face_normals[left[0]]
    fixed_positions = np.array([mesh.p.T[i] for i, node in enumerate(nodes) if tuple(node) in fixed])
    assert np.all(fixed_positions @ normal >= 4 - np.sqrt(3) - 1e-9)
    for facet in loads[0]["facets"]:
        center = np.mean(np.array(list(facet)), axis=0) + box.bounds[0]
        assert center @ box.face_normals[right[0]] >= 4 - np.sqrt(3) - 1e-9


def verify_curved_surface_membership_and_preservation(solver):
    cylinder = trimesh.creation.cylinder(radius=4, height=6, sections=24)
    bottom = np.flatnonzero(cylinder.face_normals[:, 2] < -0.99).tolist()
    top = np.flatnonzero(cylinder.face_normals[:, 2] > 0.99).tolist()
    curved = np.flatnonzero((cylinder.face_normals[:, 0] > 0.8) & (np.abs(cylinder.face_normals[:, 2]) < 0.1)).tolist()
    request = surface_request(cylinder, bottom, top)
    request["loadCases"][0]["forceN"] = [0, 0, 10]
    source, origin, cells, mesh, nodes, fixed, loads, protected = boundary_state(solver, request)
    region = {"kind": "surface", "triangleIndices": curved, "depthMm": 2}
    request["preserveRegions"] = [region]
    _, _, _, _, _, preserved_fixed, preserved_loads, preserved = boundary_state(solver, request)
    extra = preserved - protected
    assert extra and preserved >= protected
    assert preserved_fixed == fixed and preserved_loads[0]["facets"] == loads[0]["facets"]
    assert all((origin + np.array(cell) + 0.5)[0] > 0 for cell in extra)
    facets = mesh.boundary_facets()
    centers = mesh.p.T[mesh.facets[:, facets].T].mean(axis=1)
    owners = mesh.f2t[0, facets]
    normals = centers - mesh.p.T[mesh.t[:, owners].T].mean(axis=1)
    normals /= np.linalg.norm(normals, axis=1)[:, None]
    matches = solver._nearest_surface(source, centers - origin, time.monotonic() + 180, normals)
    mask = solver._surface_mask(matches, solver._region(region, len(source.faces)), np.sqrt(3))
    assert np.any(mask)
    assert np.all(normals[mask, 2] == 0), "A curved-side target must exclude adjacent end faces."
    assert np.all(centers[mask, 0] > 0)
    shallow = {**region, "depthMm": 0.1}
    request["preserveRegions"] = [shallow]
    shallow_protected = boundary_state(solver, request)[-1]
    assert shallow_protected < preserved, "Increasing preservation depth must retain more actual selected-face cells."


def verify_trimmed_surface_ties_and_missing_facets(solver):
    box = trimesh.creation.box(extents=[6, 6, 6])
    left, right = end_faces(box)
    request = surface_request(box, left, right)
    source, origin, _, _, _, _, full_loads, _ = boundary_state(solver, request)
    tie = solver._nearest_surface(source, np.array([[3, 0, 0]]) - origin, time.monotonic() + 180, np.array([[1, 0, 0]]))
    half = {"kind": "surface", "triangleIndices": right[:1], "depthMm": 0.1}
    assert not solver._surface_mask(tie, solver._region(half, len(source.faces)), np.sqrt(3))[0]
    assert solver._surface_mask(tie, solver._region(request["loadCases"][0]["region"], len(source.faces)), np.sqrt(3))[0]
    request["loadCases"][0]["region"] = half
    trimmed_loads = boundary_state(solver, request)[-2]
    assert 0 < len(trimmed_loads[0]["facets"]) < len(full_loads[0]["facets"])
    reversed_half = {**half, "triangleIndices": list(reversed(right))}
    request["loadCases"][0]["region"] = reversed_half
    assert boundary_state(solver, request)[-2][0]["facets"] == full_loads[0]["facets"]

    for _ in range(4):
        box = box.subdivide()
    left, right = end_faces(box)
    small = np.flatnonzero((box.face_normals[:, 0] > 0.99) &
                          (box.triangles_center[:, 1] < -2.75) &
                          (box.triangles_center[:, 2] < -2.75)).tolist()
    assert small
    request = surface_request(box, left, small)
    failure = json.loads(solver.solve_json(json.dumps(request)))
    assert failure["ok"] is False and failure["error"]["code"] == "no-load-facets"
    assert "result" not in failure
    request["loadCases"][0]["region"]["triangleIndices"] = right
    request["preserveRegions"] = [{"kind": "surface", "triangleIndices": small, "depthMm": 0.1}]
    failure = json.loads(solver.solve_json(json.dumps(request)))
    assert failure["ok"] is False and failure["error"]["code"] == "no-preserve-cells"


def verify_surface_boundary_freeze(solver):
    box = trimesh.creation.box(extents=[6, 6, 6])
    request = surface_request(box, *end_faces(box), iterations=2)
    before = json.dumps(request, sort_keys=True)
    _, origin, _, _, _, _, _, protected = boundary_state(solver, request)
    result = solver.solve(request)
    assert json.dumps(request, sort_keys=True) == before
    assert result["status"] == "improved" and result["finalCellCount"] < 216
    assert np.isclose(result["baseline"]["maxVonMisesMpa"], 10 / 36, rtol=1e-9)
    assert np.isclose(result["baseline"]["maxDisplacementMm"], 10 * 6 / (1000 * 36), rtol=1e-9)
    output = trimesh.Trimesh(np.array(result["mesh"]["vertices"]).reshape(-1, 3),
                             np.array(result["mesh"]["indices"]).reshape(-1, 3), process=False)
    assert output.is_watertight and output.is_winding_consistent and output.is_volume
    assert np.isclose(output.volume, result["optimized"]["volumeMm3"])
    assert result["optimized"]["volumeMm3"] == result["finalCellCount"]
    for x in [-3, 3]:
        triangles = output.triangles[np.all(np.isclose(output.triangles[:, :, 0], x), axis=1)]
        assert np.isclose(trimesh.triangles.area(triangles).sum(), 36)
    centers = origin + np.array(sorted(protected)) + 0.5
    assert np.all(solver.contains_points(solver._RayIntersector(output), centers,
                                        check_direction=[0.4395064455, 0.617598629942, 0.652231566745]))
    repeated = solver.solve(request)
    assert result["optimized"] == repeated["optimized"] and result["mesh"] == repeated["mesh"]
