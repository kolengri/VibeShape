"""Physical fixtures whose useful work exceeds the former execution ceilings."""

import itertools
import math
import numpy as np
import trimesh


def resource_request(extents=(10, 2, 2)):
    mesh = trimesh.creation.box(extents=extents)
    lo, hi = mesh.bounds
    return {
        "schemaVersion": 1,
        "mesh": {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0, "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2,
        "maxDisplacementMm": 1,
        "cellSizeMm": 1,
        "supports": [{"min": lo.tolist(), "max": [float(lo[0]), float(hi[1]), float(hi[2])]}],
        "loadCases": [{"name": "axial", "region": {"min": [float(hi[0]), float(lo[1]), float(lo[2])],
                     "max": hi.tolist()}, "forceN": [10, 0, 0]}],
        "preserveRegions": [],
        "maxIterations": 0,
    }


def verify_sparse_candidate_grid(solver):
    source = trimesh.creation.box(extents=[160, 3, 2])
    rotation = trimesh.transformations.rotation_matrix(math.atan(0.5), [0, 0, 1])
    source.apply_transform(rotation)
    request = resource_request()
    request["mesh"] = {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()}
    normalized, origin, _ = solver._source(request, 1, float("-inf"))
    shape = np.floor(normalized.bounds[1] + solver.CELL_TOLERANCE).astype(int)
    cells = solver._voxelize(normalized, float("-inf"))
    assert math.prod(int(value) for value in shape) > 12000
    assert 0 < len(cells) < 3000
    corners = origin + cells[:, None, :] + solver.HEX_CORNERS
    local = corners @ rotation[:3, :3]
    assert np.all(np.abs(local) <= np.array([80, 1.5, 1]) + 1e-8)


def verify_large_analytical_beam(solver):
    request = resource_request((251, 4, 3))
    request["algorithm"] = {"kind": "simp", "volumeFraction": 1, "filterRadiusMm": 1.5, "penalty": 3}
    result = solver.solve(request)
    assert result["initialCellCount"] == result["finalCellCount"] == 3012
    assert np.isclose(result["sourceVolumeMm3"], 3012, rtol=1e-12)
    assert np.isclose(result["baseline"]["maxVonMisesMpa"], 10 / 12, rtol=1e-7)
    assert np.isclose(result["baseline"]["maxDisplacementMm"], 10 * 251 / (1000 * 12), rtol=1e-7)
    assert result["optimized"] == result["baseline"]
    cells = np.array(list(itertools.product(range(251), range(4), range(3))))
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    assert len(nodes) == 5040 and mesh.nelements == 3012
    return result


def verify_large_filter_and_morphology(solver):
    cells = np.array(list(itertools.product(range(10), repeat=3)))
    matrix, sums = solver._sensitivity_filter(cells, 100000, float("-inf"))
    assert matrix.nnz == 1000000
    assert np.all(np.isfinite(matrix.data)) and np.all(sums > 0)
    assert np.allclose(matrix @ np.ones(len(cells)) / sums, 1, rtol=1e-12)
    assert (matrix - matrix.T).nnz == 0
    occupied = np.array(list(itertools.product(range(24), repeat=3)))
    settings = {"buildDirection": "+z", "supportMode": "allowed", "minFeatureSizeMm": 2,
                "layerHeightMm": 1, "maxOverhangAngleDeg": 45}
    context = solver._fdm_context(settings, occupied, np.zeros(3), 1)
    assert solver._fdm_feature_bound(occupied, np.zeros(3), 1, context) == 2
    cube = np.array(list(itertools.product(range(23), repeat=3)))
    opened = solver._coverage_opening(np.ones(len(cube), dtype=bool), cube, 23)
    assert np.all(opened)


def verify_many_settings_and_user_iterations(solver):
    request = resource_request()
    request["supports"] *= 9
    request["loadCases"] = [{**request["loadCases"][0], "name": f"case-{index}"} for index in range(9)]
    request["preserveRegions"] = [{"min": [-5, -1, -1], "max": [5, 1, 1]}] * 17
    request["obstacleRegions"] = [{"min": [20 + index, 0, 0], "max": [20.5 + index, 1, 1]} for index in range(17)]
    request["maxIterations"] = 41
    result = solver.solve(request)
    assert result["termination"] == "no-removable-cells"
    assert result["initialCellCount"] == result["finalCellCount"] == 40
    assert len(result["optimized"]["cases"]) == 9
    assert all(np.isclose(case["maxDisplacementMm"], 0.025, rtol=1e-9) for case in result["optimized"]["cases"])


def verify_many_cavity_shells(solver):
    shells = [trimesh.creation.box(extents=[20, 20, 20])]
    for center in itertools.product((-6, -2, 2, 6), repeat=3):
        cavity = trimesh.creation.box(extents=[1, 1, 1])
        cavity.apply_translation(center)
        cavity.invert()
        shells.append(cavity)
    mesh = trimesh.util.concatenate(shells)
    solver._check_surface(mesh, "Many cavities", float("-inf"))
    assert np.isclose(mesh.volume, 8000 - 64, rtol=1e-12)
