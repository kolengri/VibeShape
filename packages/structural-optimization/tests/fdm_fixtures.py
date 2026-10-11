"""FDM coverage, footprint, axis, and float32 invariants in the pinned runtime."""

import copy
import itertools
import json
import time

import numpy as np
import trimesh


def fdm_settings(direction="+z", mode="allowed", minimum=1.2):
    return {"buildDirection": direction, "supportMode": mode, "minFeatureSizeMm": minimum,
            "layerHeightMm": 0.2, "maxOverhangAngleDeg": 45}


def fdm_request(solver, cells, fdm=None, iterations=0, translation=None):
    origin = np.zeros(3) if translation is None else np.array(translation)
    cells = np.array(cells, dtype=int)
    mesh, _ = solver._hex_mesh(cells, origin, 1)
    source = solver._surface(mesh)
    lo, hi = source.bounds
    request = {
        "schemaVersion": 1,
        "mesh": {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0, "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2, "maxDisplacementMm": 1, "cellSizeMm": 1,
        "supports": [{"min": lo.tolist(), "max": [float(lo[0]), float(hi[1]), float(hi[2])]}],
        "loadCases": [{"name": "axial", "region": {"min": [float(hi[0]), float(lo[1]), float(lo[2])], "max": hi.tolist()}, "forceN": [1, 0, 0]}],
        "preserveRegions": [], "maxIterations": iterations,
    }
    if fdm is not None:
        request["fdm"] = fdm
    return request


def fdm_expect_code(solver, request, code):
    try:
        solver.solve(request)
    except solver.SolverError as error:
        assert error.code == code, (error.code, str(error))
    else:
        raise AssertionError(f"Expected {code}, but the solver published geometry.")


def verify_fdm_axes_and_cubes(solver):
    cube = list(itertools.product(range(2), repeat=3))
    for direction in ("+x", "-x", "+y", "-y", "+z", "-z"):
        request = fdm_request(solver, cube, fdm_settings(direction, "forbidden"))
        result = solver.solve(request)
        summary = result["fdm"]
        assert summary["settings"] == request["fdm"]
        assert summary["minimumFeatureCubeCells"] == 2
        assert abs(summary["horizontalReachMm"] - 0.2) < 1e-12
        assert summary["buildPlateCoordinateMm"] == (0 if direction[0] == "+" else 2)
        for metrics in (summary["baseline"], summary["optimized"]):
            assert metrics == {"unsupportedAreaMm2": 0, "requiresSupports": False,
                               "minFeatureSizeBoundMm": 2, "buildHeightMm": 2}
        assert result["optimized"]["volumeMm3"] == 8
    # Volume and neighbor count cannot rescue a one-voxel sheet or rod.
    for cells in (list(itertools.product(range(4), range(1), range(4))),
                  list(itertools.product(range(10), range(1), range(1)))):
        fdm_expect_code(solver, fdm_request(solver, cells, fdm_settings()), "infeasible-baseline")
    request = fdm_request(solver, cube, fdm_settings(minimum=100000))
    fdm_expect_code(solver, request, "infeasible-baseline")
    # A union of overlapping full cubes covers a corner-cut 3-cube shape.
    cells = np.array([c for c in itertools.product(range(3), repeat=3) if c != (0, 0, 0)])
    context = solver._fdm_context(fdm_settings(), cells, np.zeros(3), 1)
    assert solver._fdm_feature_bound(cells, np.zeros(3), 1, context) == 2


def verify_fdm_footprints_and_support_modes(solver):
    # L-shaped cells: corner/edge proximity cannot cover the whole one-mm face
    # with 0.2 mm of one-print-layer reach, despite a diagonally connected mesh.
    cells = [(0, 0, 0), (0, 0, 1), (1, 0, 1)]
    request = fdm_request(solver, cells, fdm_settings(minimum=1))
    result = solver.solve(request)
    metrics = result["fdm"]["baseline"]
    assert metrics["requiresSupports"]
    assert abs(metrics["unsupportedAreaMm2"] - (1 - 0.2 / np.sqrt(2))) < 1e-10
    request["fdm"]["supportMode"] = "forbidden"
    fdm_expect_code(solver, request, "infeasible-baseline")
    request["fdm"]["buildDirection"] = "-z"
    flipped = solver.solve(request)
    assert flipped["fdm"]["optimized"]["unsupportedAreaMm2"] == 0
    assert flipped["fdm"]["buildPlateCoordinateMm"] == 2
    # Independent surface area: with zero angle all exposed non-bed downward
    # faces are unsupported; no connectivity or neighbor-count proxy is used.
    request["fdm"] = fdm_settings(minimum=1)
    request["fdm"]["maxOverhangAngleDeg"] = 0
    zero = solver.solve(request)
    assert zero["fdm"]["optimized"]["unsupportedAreaMm2"] == 1
    # Several neighboring rectangles can jointly cover a footprint at sufficient
    # reach. Union coverage must not sum overlapping areas twice.
    rectangles = np.array([[-1, 0, 0, 1], [1, 0, 2, 1]], dtype=float)
    assert solver._fdm_uncovered_face(np.array([0, 0, 1, 1]), rectangles, 0.5) == 0
    assert abs(solver._fdm_uncovered_face(np.array([0, 0, 1, 1]), rectangles, 0.2) - 0.6) < 1e-12


def assert_fdm_output(solver, request, result):
    raw = np.array(result["mesh"]["vertices"]).reshape(-1, 3)
    mesh = trimesh.Trimesh(raw, np.array(result["mesh"]["indices"]).reshape(-1, 3), process=False)
    assert mesh.is_volume and abs(mesh.volume - result["optimized"]["volumeMm3"]) < 1e-8
    # Independently enumerate cells via the final exported solid and independently
    # enumerate every full cube; verify union coverage for each occupied cell.
    lo = np.array(request["mesh"]["vertices"]).reshape(-1, 3).min(axis=0)
    dimensions = np.rint((raw.max(axis=0) - lo) / request["cellSizeMm"]).astype(int)
    grid = np.indices(tuple(dimensions)).reshape(3, -1).T
    from trimesh.ray.ray_util import contains_points
    mask = contains_points(solver._RayIntersector(mesh), lo + (grid + 0.5) * request["cellSizeMm"])
    occupied = {tuple(c) for c in grid[mask]}
    k = result["fdm"]["minimumFeatureCubeCells"]
    covered = set()
    for anchor in occupied:
        cube = {tuple(np.array(anchor) + offset) for offset in itertools.product(range(k), repeat=3)}
        if cube <= occupied:
            p0, p1 = lo + np.array(anchor), lo + np.array(anchor) + k
            bound = min((p1 - p0).min(), (p1.astype(np.float32).astype(float) - p0.astype(np.float32).astype(float)).min())
            if bound >= request["fdm"]["minFeatureSizeMm"]:
                covered |= cube
    assert covered == occupied
    assert len(occupied) == result["finalCellCount"]


def verify_fdm_constraints_change_removal(solver):
    cells = list(itertools.product(range(10), range(2), range(2)))
    request = fdm_request(solver, cells, iterations=4)
    request["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": 0.95}
    legacy = solver.solve(request)
    assert "fdm" not in legacy and legacy["finalCellCount"] == 38
    request["fdm"] = fdm_settings("+x", "allowed", 1)
    allowed = solver.solve(request)
    assert allowed["finalCellCount"] == 38
    assert allowed["fdm"]["baseline"]["unsupportedAreaMm2"] == 0
    assert allowed["fdm"]["optimized"]["requiresSupports"]
    assert_fdm_output(solver, request, allowed)
    request["fdm"]["supportMode"] = "forbidden"
    forbidden = solver.solve(request)
    assert forbidden["finalCellCount"] == 40
    assert not forbidden["fdm"]["optimized"]["requiresSupports"]
    assert forbidden["objective"]["targetStatus"] == "not-reached"
    assert forbidden["termination"] == "constraints-or-topology"
    request["fdm"] = fdm_settings("+z", "allowed", 1.2)
    feature = solver.solve(request)
    assert feature["finalCellCount"] == 40
    assert feature["fdm"]["optimized"]["minFeatureSizeBoundMm"] == 2
    assert_fdm_output(solver, request, feature)
    # FDM does not move the bed upward when a candidate loses its original bed
    # cells: such a floating candidate still has exposed unsupported footprints.
    floating = np.array([(0, 0, 1), (1, 0, 1)])
    context = solver._fdm_context(fdm_settings(minimum=1), np.array([(0, 0, 0), *floating]), np.zeros(3), 1)
    measured = solver._fdm_metrics(floating, np.zeros(3), 1, context, time.monotonic() + 10)
    assert measured["unsupportedAreaMm2"] == 2 and measured["buildHeightMm"] == 2
    # Keep-out exclusion precedes FDM baseline validation and retained-mass
    # accounting. The resulting notch can invalidate a different build axis
    # or full-cube minimum while remaining valid with supports allowed.
    combined = fdm_request(solver, cells, fdm_settings(minimum=1))
    combined["obstacleRegions"] = [{"min": [4.1, 1.1, 1.1], "max": [4.2, 1.2, 1.2]}]
    combined["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": 0.95}
    excluded = solver.solve(combined)
    assert excluded["initialCellCount"] == excluded["finalCellCount"] == 39
    assert excluded["objective"]["targetCellCount"] == 38
    assert abs(excluded["sourceVolumeLossFraction"] - 1 / 40) < 1e-10
    assert_fdm_output(solver, combined, excluded)
    final_mesh = trimesh.Trimesh(np.array(excluded["mesh"]["vertices"]).reshape(-1, 3),
                               np.array(excluded["mesh"]["indices"]).reshape(-1, 3), process=False)
    from trimesh.ray.ray_util import contains_points
    assert not contains_points(solver._RayIntersector(final_mesh), np.array([[4.5, 1.5, 1.5]]))[0]
    combined["fdm"] = fdm_settings("-z", "forbidden", 1)
    fdm_expect_code(solver, combined, "infeasible-baseline")
    combined["fdm"] = fdm_settings(minimum=1.2)
    fdm_expect_code(solver, combined, "infeasible-baseline")


def verify_fdm_float32_bound(solver):
    cells = list(itertools.product(range(10), range(2), range(2)))
    request = fdm_request(solver, cells, fdm_settings(minimum=1), translation=[0.1, 0.1, 0.1])
    # For example, f32(2.1)-f32(1.1) is strictly less than 1 mm while the
    # endpoint errors remain within the existing one-millionth-cell allowance.
    assert float(np.float32(2.1)) - float(np.float32(1.1)) < 1
    fdm_expect_code(solver, request, "infeasible-baseline")
    request["fdm"]["minFeatureSizeMm"] = 0.999999
    result = solver.solve(request)
    bound = result["fdm"]["optimized"]["minFeatureSizeBoundMm"]
    assert 0.999999 <= bound < 1
    assert_fdm_output(solver, request, result)
    return request


def verify_fdm_rounded_slice_height(solver):
    # Nominal one-mm levels can skip the rounded middle stair when the printed
    # layer is exactly one mm. The upper footprint then exceeds the allowed reach.
    cells = [(0, 0, 0), (0, 0, 1), (1, 0, 1),
             (0, 0, 2), (1, 0, 2), (2, 0, 2)]
    settings = fdm_settings(mode="forbidden", minimum=0.999999)
    settings["layerHeightMm"] = 1
    settings["maxOverhangAngleDeg"] = 60
    request = fdm_request(solver, cells, settings, translation=[0.1, 0.1, 0.1])
    assert float(np.float32(2.1)) - float(np.float32(1.1)) < 1
    fdm_expect_code(solver, request, "invalid-input")
    envelope = json.loads(solver.solve_json(json.dumps(request)))
    assert not envelope["ok"] and envelope["error"]["code"] == "invalid-input"
    # Supports-allowed must not publish a misleading area estimate either.
    request["fdm"]["supportMode"] = "allowed"
    fdm_expect_code(solver, request, "invalid-input")
    request["fdm"]["supportMode"] = "forbidden"
    request["fdm"]["layerHeightMm"] = 0.9
    result = solver.solve(request)
    assert result["fdm"]["optimized"]["unsupportedAreaMm2"] == 0
    assert_fdm_output(solver, request, result)
    # Shrinking non-build axes does not make integer Z slices too short.
    request = fdm_request(solver, cells, settings, translation=[0.1, 0.1, 0])
    request["fdm"]["layerHeightMm"] = 1
    assert solver.solve(request)["fdm"]["optimized"]["unsupportedAreaMm2"] == 0


def verify_invalid_fdm_settings(solver):
    request = fdm_request(solver, list(itertools.product(range(2), repeat=3)))
    patches = [{"buildDirection": "z"}, {"buildDirection": []}, {"supportMode": []},
               {"minFeatureSizeMm": 0}, {"layerHeightMm": 0.0001}, {"maxOverhangAngleDeg": 90},
               {"maxOverhangAngleDeg": -1}, {"minFeatureSizeMm": float("nan")},
               {"layerHeightMm": float("inf")}, {"minFeatureSizeMm": True}, {"extra": True}]
    for patch in patches:
        request["fdm"] = {**fdm_settings(), **patch}
        fdm_expect_code(solver, request, "invalid-input")
    for malformed in (None, [], {}, {"buildDirection": "+z"}):
        request["fdm"] = malformed
        fdm_expect_code(solver, request, "invalid-input")
    # The immediate lower voxel at (1,0,1) covers (1,0,2), but with a
    # two-cell print layer the preceding printed slice lacks (1,0,0).
    # The one-slice approximation must reject this physical layer height.
    stepped = [(0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 2)]
    request = fdm_request(solver, stepped, fdm_settings(minimum=1))
    request["fdm"]["layerHeightMm"] = 2
    request["fdm"]["maxOverhangAngleDeg"] = 0
    fdm_expect_code(solver, request, "invalid-input")
    envelope = json.loads(solver.solve_json(json.dumps(request)))
    assert not envelope["ok"] and envelope["error"]["code"] == "invalid-input"
    request["fdm"]["layerHeightMm"] = 1
    assert solver.solve(request)["fdm"]["settings"]["layerHeightMm"] == 1
