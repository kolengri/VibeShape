"""Independent elasticity, geometric, and rejected-input acceptance fixtures."""

import copy
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest
import trimesh


spec = importlib.util.spec_from_file_location("structural_solver", Path(__file__).parents[1] / "src" / "solver.py")
solver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(solver)


def request_for_box(iterations=0):
    mesh = trimesh.creation.box(extents=[10, 2, 2])
    return {
        "schemaVersion": 1,
        "mesh": {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0, "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2,
        "maxDisplacementMm": 1,
        "cellSizeMm": 1,
        "supports": [{"min": [-5, -1, -1], "max": [-5, 1, 1]}],
        "loadCases": [{"name": "axial", "region": {"min": [5, -1, -1], "max": [5, 1, 1]}, "forceN": [10, 0, 0]}],
        "preserveRegions": [],
        "maxIterations": iterations,
    }


def output_mesh(result):
    return trimesh.Trimesh(np.array(result["mesh"]["vertices"]).reshape(-1, 3),
                           np.array(result["mesh"]["indices"]).reshape(-1, 3), process=False)


@pytest.mark.parametrize("cell_size", [0.5, 1, 2])
def test_uniform_axial_elasticity_matches_analytical_solution(cell_size):
    # Poisson ratio zero makes fully clamping one end compatible with the exact
    # uniform uniaxial field: stress=F/A and u=FL/(EA).
    request = request_for_box()
    request["cellSizeMm"] = cell_size
    result = solver.solve(request)
    baseline = result["baseline"]
    assert baseline["volumeMm3"] == pytest.approx(40)
    assert baseline["massKg"] == pytest.approx(0.00004)
    assert baseline["maxVonMisesMpa"] == pytest.approx(2.5, rel=1e-9)
    assert baseline["maxDisplacementMm"] == pytest.approx(0.025, rel=1e-9)
    assert baseline["safetyFactor"] == pytest.approx(40, rel=1e-9)
    assert baseline["cases"][0]["complianceNmm"] == pytest.approx(0.25, rel=1e-9)
    assert result["optimized"] == baseline
    assert result["evaluations"] == 2
    assert result["sourceVolumeLossFraction"] == pytest.approx(0)
    assert output_mesh(result).volume == pytest.approx(40)


def test_feasible_removal_retains_frozen_boundaries_and_emits_analyzed_solid():
    result = solver.solve(request_for_box(4))
    assert result["status"] == "improved"
    assert result["finalCellCount"] < result["initialCellCount"]
    assert result["optimized"]["safetyFactor"] >= 2
    assert result["optimized"]["maxDisplacementMm"] <= 1
    assert result["evaluations"] > 2
    mesh = output_mesh(result)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume
    assert mesh.volume == pytest.approx(result["optimized"]["volumeMm3"])
    assert mesh.volume == pytest.approx(result["finalCellCount"])
    assert np.all(mesh.vertices >= [-5, -1, -1])
    assert np.all(mesh.vertices <= [5, 1, 1])
    # Both authored end planes retain their complete original support/load areas.
    for x in [-5, 5]:
        triangles = mesh.triangles[np.all(np.isclose(mesh.triangles[:, :, 0], x), axis=1)]
        assert trimesh.triangles.area(triangles).sum() == pytest.approx(4)


def test_all_preserved_cells_return_verified_no_improvement():
    request = request_for_box(4)
    request["preserveRegions"] = [{"min": [-5, -1, -1], "max": [5, 1, 1]}]
    result = solver.solve(request)
    assert result["status"] == "no-improvement"
    assert result["termination"] == "no-removable-cells"
    assert result["optimized"] == result["baseline"]


def test_every_load_case_constrains_the_result_and_has_separate_metrics():
    request = request_for_box(2)
    second = copy.deepcopy(request["loadCases"][0])
    second.update(name="double", forceN=[20, 0, 0])
    request["loadCases"].append(second)
    result = solver.solve(request)
    axial, double = result["optimized"]["cases"]
    assert double["maxVonMisesMpa"] == pytest.approx(2 * axial["maxVonMisesMpa"])
    assert double["maxDisplacementMm"] == pytest.approx(2 * axial["maxDisplacementMm"])
    assert result["optimized"]["maxVonMisesMpa"] == double["maxVonMisesMpa"]
    assert result["optimized"]["safetyFactor"] == double["safetyFactor"]


def bending_request():
    request = request_for_box()
    mesh = trimesh.creation.box(extents=[20, 4, 4])
    request["mesh"] = {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()}
    request["supports"] = [{"min": [-10, -2, -2], "max": [-10, 2, 2]}]
    request["loadCases"][0].update(name="bending", region={"min": [10, -2, -2], "max": [10, 2, 2]}, forceN=[0, 0, -1])
    return request


def test_cantilever_bending_matches_beam_theory_within_discretization_tolerance():
    result = solver.solve(bending_request())
    # Independent slender-beam limit, I=4*4^3/12, tip displacement=FL^3/(3EI),
    # root extreme-fibre stress=FL*(h/2)/I.  Three-dimensional shear and the
    # clamped-end boundary layer account for the finite tolerance.
    assert result["baseline"]["maxDisplacementMm"] == pytest.approx(0.125, rel=0.03)
    assert result["baseline"]["maxVonMisesMpa"] == pytest.approx(1.875, rel=0.03)


def test_bending_stress_limit_rejects_even_when_displacement_is_feasible():
    request = bending_request()
    request["material"]["yieldStrengthMpa"] = 3.4
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "infeasible-baseline"


def test_large_strain_rejects_even_with_permissive_user_constraints():
    request = request_for_box()
    request["loadCases"][0]["forceN"] = [400, 0, 0]
    request["material"]["yieldStrengthMpa"] = 10000
    request["maxDisplacementMm"] = 10
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "small-strain-limit"


def test_repeated_runs_are_deterministic_without_mutating_the_source():
    request = request_for_box(4)
    before = copy.deepcopy(request)
    first = solver.solve(request)
    second = solver.solve(request)
    assert request == before
    assert first["finalCellCount"] == second["finalCellCount"]
    assert first["optimized"] == second["optimized"]
    assert first["termination"] == second["termination"]


@pytest.mark.parametrize("field,value,code", [
    ("supports", [], "no-support-nodes"),
    ("supports", [{"min": [-6, -1, -1], "max": [-6, 1, 1]}], "no-support-nodes"),
    ("supports", [{"min": [-5, -1, -1], "max": [-5, -1, -1]}], "underconstrained"),
    ("maxDisplacementMm", 0.001, "infeasible-baseline"),
    ("safetyFactor", 50, "infeasible-baseline"),
    ("cellSizeMm", 0.01, "resource-limit"),
    ("cellSizeMm", 20, "resolution-empty"),
    ("maxIterations", -1, "invalid-input"),
    ("maxIterations", 41, "invalid-input"),
    ("cellSizeMm", float("nan"), "invalid-input"),
])
def test_rejected_inputs_never_return_a_mesh(field, value, code):
    request = request_for_box()
    request[field] = value
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == code


def test_source_must_be_closed_and_connected():
    request = request_for_box()
    request["mesh"]["indices"] = request["mesh"]["indices"][:-3]
    with pytest.raises(solver.SolverError, match="closed"):
        solver.solve(request)
    left = trimesh.creation.box(extents=[2, 2, 2])
    right = left.copy()
    right.apply_translation([5, 0, 0])
    mesh = trimesh.util.concatenate([left, right])
    request["mesh"] = {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()}
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "disconnected-mesh"


def test_load_region_requires_complete_actual_facets_without_snapping():
    request = request_for_box()
    request["loadCases"][0]["region"] = {"min": [6, -1, -1], "max": [6, 1, 1]}
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "no-load-facets"


def test_load_support_overlap_is_rejected():
    request = request_for_box()
    request["loadCases"][0]["region"] = {"min": [-5, -1, -1], "max": [-5, 1, 1]}
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "load-support-overlap"


def test_noninteger_source_indices_and_infinite_material_are_rejected():
    request = request_for_box()
    request["mesh"]["indices"][0] = 0.5
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "invalid-input"
    request = request_for_box()
    request["material"]["youngModulusMpa"] = float("inf")
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "invalid-input"


def test_json_envelope_has_typed_errors_and_no_nonfinite_result():
    success = json.loads(solver.solve_json(json.dumps(request_for_box())))
    assert success["ok"] is True
    failure = json.loads(solver.solve_json("{invalid"))
    assert failure["ok"] is False
    assert failure["error"]["code"] == "invalid-input"
    assert "result" not in failure


def test_conservative_cell_clipping_never_emits_rotated_source_expansion():
    request = request_for_box()
    mesh = trimesh.creation.box(extents=[10, 4, 4])
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 4, [1, 0, 0]))
    request["mesh"] = {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()}
    # The conservative body does not necessarily retain nodes on an original
    # oblique surface.  Use the exact axial end planes for both boundary regions.
    request["supports"] = [{"min": [-5, -3, -3], "max": [-5, 3, 3]}]
    request["loadCases"][0]["region"] = {"min": [5, -3, -3], "max": [5, 3, 3]}
    result = solver.solve(request)
    vertices = output_mesh(result).vertices
    # Independent analytic half-space test for the rotated square cross-section.
    cross = vertices[:, 1:3] @ np.array([[np.cos(np.pi / 4), -np.sin(np.pi / 4)],
                                       [np.sin(np.pi / 4), np.cos(np.pi / 4)]])
    assert np.max(np.abs(cross)) <= 2 + 1e-6
    assert result["sourceVolumeLossFraction"] > 0
    assert result["baseline"]["volumeMm3"] < 160
