"""Keep-out invariants shared by native Python and the pinned browser runtime."""

import copy

import numpy as np
import trimesh
from trimesh.ray.ray_util import contains_points


def obstacle_bar(iterations=0):
    mesh = trimesh.creation.box(extents=[10, 4, 4])
    return {
        "schemaVersion": 1,
        "mesh": {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0, "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2,
        "maxDisplacementMm": 1,
        "cellSizeMm": 1,
        "supports": [{"min": [-5, -2, -2], "max": [-5, 2, 2]}],
        "loadCases": [{"name": "axial", "region": {"min": [5, -2, -2], "max": [5, 2, 2]}, "forceN": [10, 0, 0]}],
        "preserveRegions": [],
        "maxIterations": iterations,
    }


def expect_code(solver, request, code):
    try:
        solver.solve(request)
    except solver.SolverError as error:
        assert error.code == code, (error.code, str(error))
    else:
        raise AssertionError(f"Expected {code}, but the solver published a result.")


def assert_keep_out_geometry(solver, request, result):
    mesh = trimesh.Trimesh(np.array(result["mesh"]["vertices"]).reshape(-1, 3),
                           np.array(result["mesh"]["indices"]).reshape(-1, 3), process=False)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume
    assert abs(mesh.volume - result["optimized"]["volumeMm3"]) < 1e-8
    # Independently recover occupied voxel centers from the exported triangle
    # solid, then measure closed-box intersection on the original world grid.
    origin = np.array([-5, -2, -2])
    cells = np.indices((10, 4, 4)).reshape(3, -1).T + origin
    occupied = contains_points(solver._RayIntersector(mesh), cells + 0.5)
    assert np.count_nonzero(occupied) == result["finalCellCount"]
    for box in request["obstacleRegions"]:
        overlap = np.all((cells <= np.array(box["max"])) & (cells + 1 >= np.array(box["min"])), axis=1)
        assert not np.any(occupied & overlap), "Exported solid occupies a closed keep-out box."
    for x in [-5, 5]:
        triangles = mesh.triangles[np.all(np.isclose(mesh.triangles[:, :, 0], x), axis=1)]
        assert abs(trimesh.triangles.area(triangles).sum() - 16) < 1e-8


def verify_obstacle_baseline_accounting(solver):
    request = obstacle_bar()
    full = solver.solve(request)
    request["obstacleRegions"] = [{"min": [-0.4, 1.1, 1.1], "max": [0.4, 1.2, 1.2]}]
    request["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": 0.5}
    original = copy.deepcopy(request)
    result = solver.solve(request)
    assert request == original
    assert result["initialCellCount"] == result["finalCellCount"] == 158
    assert abs(result["baseline"]["volumeMm3"] - 158) < 1e-8
    assert abs(result["sourceVolumeMm3"] - 160) < 1e-8
    assert abs(result["sourceVolumeLossFraction"] - 2 / 160) < 1e-8
    assert result["baseline"]["maxDisplacementMm"] > full["baseline"]["maxDisplacementMm"]
    assert result["objective"]["targetCellCount"] == 79
    assert abs(result["objective"]["targetMassKg"] - 0.000079) < 1e-12
    assert result["objective"]["targetStatus"] == "not-reached"
    assert any("obstacle-excluded baseline" in warning for warning in result["warnings"])
    assert_keep_out_geometry(solver, request, result)
    request["maxIterations"] = 4
    request["objective"]["retainedMassFraction"] = 0.99
    optimized = solver.solve(request)
    assert optimized["initialCellCount"] == 158
    assert optimized["finalCellCount"] == 157
    assert optimized["objective"]["targetStatus"] == "reached"
    assert_keep_out_geometry(solver, request, optimized)


def serialization_clearance_request():
    request = obstacle_bar()
    points = np.array(request["mesh"]["vertices"]).reshape(-1, 3) * 0.2
    points[:, 0] += 1.2
    request["mesh"]["vertices"] = points.ravel().tolist()
    request["cellSizeMm"] = 0.2
    request["supports"] = [{"min": [0.2, -0.4, -0.4], "max": [0.2, 0.4, 0.4]}]
    request["loadCases"][0]["region"] = {"min": [2.2, -0.4, -0.4], "max": [2.2, 0.4, 0.4]}
    # x=1.2 rounds upward to 1.2000000476837158 in the production STL encoder.
    request["obstacleRegions"] = [{"min": [1.20000002, 0.22, 0.22], "max": [1.24, 0.24, 0.24]}]
    return request


def verify_closed_obstacle_contact(solver):
    for minimum, maximum, expected_removed in [([0, 1.1, 1.1], [0.1, 1.2, 1.2], 2),
                                               ([0, 0, 1.1], [0.1, 0.1, 1.2], 4),
                                               ([0, 0, 0], [0.1, 0.1, 2.1], 12)]:
        request = obstacle_bar()
        request["obstacleRegions"] = [{"min": minimum, "max": maximum}]
        result = solver.solve(request)
        assert result["initialCellCount"] == 160 - expected_removed
        assert_keep_out_geometry(solver, request, result)
    # A closed box touching an exterior face conservatively removes the cells
    # touching it, even though its positive volume lies outside the source.
    request = obstacle_bar()
    request["obstacleRegions"] = [{"min": [-0.4, 2, 1.1], "max": [0.4, 2.1, 1.2]}]
    result = solver.solve(request)
    assert result["initialCellCount"] == 158
    assert_keep_out_geometry(solver, request, result)
    request["obstacleRegions"] = [{"min": [20, 20, 20], "max": [21, 21, 21]}]
    assert solver.solve(request)["initialCellCount"] == 160
    request["obstacleRegions"] *= 16
    assert solver.solve(request)["initialCellCount"] == 160


def verify_obstacle_conflicts_and_mapping(solver):
    for x in [-4.5, 4.4]:
        request = obstacle_bar()
        request["obstacleRegions"] = [{"min": [x, 0.1, 0.1], "max": [x + 0.1, 0.2, 0.2]}]
        expect_code(solver, request, "invalid-input")
    request = obstacle_bar()
    request["preserveRegions"] = [{"min": [-0.5, -0.4, -0.4], "max": [0.5, 0.4, 0.4]}]
    request["obstacleRegions"] = [{"min": [-0.2, 0.1, 0.1], "max": [-0.1, 0.2, 0.2]}]
    expect_code(solver, request, "invalid-input")
    request = obstacle_bar()
    source = trimesh.Trimesh(np.array(request["mesh"]["vertices"]).reshape(-1, 3),
                             np.array(request["mesh"]["indices"]).reshape(-1, 3), process=False)
    top = np.flatnonzero(np.isclose(source.triangles_center[:, 2], 2)).tolist()
    request["preserveRegions"] = [{"kind": "surface", "triangleIndices": top, "depthMm": 0.25}]
    request["obstacleRegions"] = [{"min": [-0.4, 1.1, 1.1], "max": [0.4, 1.2, 1.2]}]
    expect_code(solver, request, "invalid-input")
    for x, key in [(-5, "supports"), (5, "loadCases")]:
        request = obstacle_bar()
        triangles = np.flatnonzero(np.isclose(source.triangles_center[:, 0], x)).tolist()
        region = {"kind": "surface", "triangleIndices": triangles, "depthMm": 0.25}
        if key == "supports":
            request["supports"] = [region]
        else:
            request["loadCases"][0]["region"] = region
        inside = -4.5 if x == -5 else 4.4
        request["obstacleRegions"] = [{"min": [inside, 0.1, 0.1], "max": [inside + 0.1, 0.2, 0.2]}]
        expect_code(solver, request, "invalid-input")
    request = obstacle_bar()
    request["supports"] = [{"min": [0, -0.9, -0.9], "max": [0, 0.9, 0.9]}]
    request["obstacleRegions"] = [{"min": [-0.4, 1.1, 1.1], "max": [0.4, 1.2, 1.2]}]
    expect_code(solver, request, "no-support-nodes")


def verify_obstacle_baseline_failures(solver):
    # An enclosed inward cavity shell represents one connected material solid.
    request = obstacle_bar()
    request["obstacleRegions"] = [{"min": [0.1, 0.1, 0.1], "max": [0.2, 0.2, 0.2]}]
    hollow = solver.solve(request)
    assert hollow["initialCellCount"] == 159
    assert hollow["optimized"]["volumeMm3"] == 159
    source = trimesh.Trimesh(np.array(hollow["mesh"]["vertices"]).reshape(-1, 3),
                             np.array(hollow["mesh"]["indices"]).reshape(-1, 3), process=False)
    assert len(source.split(only_watertight=True)) == 2
    assert abs(source.volume - 159) < 1e-8
    request = obstacle_bar()
    request["obstacleRegions"] = [{"min": [-0.2, -3, -3], "max": [0.2, 3, 3]}]
    expect_code(solver, request, "infeasible-baseline")
    request = obstacle_bar()
    full = solver.solve(request)
    request["maxDisplacementMm"] = full["baseline"]["maxDisplacementMm"] * (1 + 1e-6)
    request["obstacleRegions"] = [{"min": [-0.4, 1.1, 1.1], "max": [0.4, 1.2, 1.2]}]
    expect_code(solver, request, "infeasible-baseline")


def verify_invalid_obstacle_boxes(solver):
    invalid = [None, {"min": [0, 0, 0], "max": [1, 1, 1]},
               [{"kind": "surface", "triangleIndices": [0], "depthMm": 1}],
               [{"min": [0, 0, 0], "max": [1, 0, 1]}],
               [{"min": [1, 0, 0], "max": [0, 1, 1]}],
               [{"min": [0, 0, 0], "max": [100001, 1, 1]}],
               [{"min": [float("nan"), 0, 0], "max": [1, 1, 1]}],
               [{"min": [0, 0, 0], "max": [float("inf"), 1, 1]}],
               [{"min": [True, 0, 0], "max": [2, 1, 1]}],
               [{"min": [0, 0, 0], "max": [1, 1, 1], "kind": "box"}],
               [{"min": [0, 0, 0], "max": [1, 1, 1]}] * 17]
    for boxes in invalid:
        request = obstacle_bar()
        request["obstacleRegions"] = boxes
        expect_code(solver, request, "invalid-input")
