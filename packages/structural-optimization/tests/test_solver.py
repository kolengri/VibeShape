"""Independent elasticity, geometric, and rejected-input acceptance fixtures."""

import copy
import importlib.util
import itertools
import json
import time
from pathlib import Path

from implicit_fixtures import (implicit_request, verify_simp_search, verify_penalized_fem_and_sensitivity,
                               verify_lattice_search, verify_implicit_failures, verify_implicit_constraints)

import numpy as np
import pytest
import trimesh
from fdm_fixtures import (verify_fdm_axes_and_cubes, verify_fdm_constraints_change_removal,
                          verify_fdm_float32_bound, verify_fdm_footprints_and_support_modes,
                          verify_fdm_rounded_slice_height, verify_invalid_fdm_settings)
from obstacle_fixtures import (verify_closed_obstacle_contact,
                               verify_invalid_obstacle_boxes,
                               verify_obstacle_baseline_accounting,
                               verify_obstacle_baseline_failures,
                               verify_obstacle_conflicts_and_mapping)
from surface_target_fixtures import (verify_curved_surface_membership_and_preservation,
                                     verify_rotated_surface_membership,
                                     verify_surface_boundary_freeze,
                                     verify_trimmed_surface_ties_and_missing_facets)


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


@pytest.mark.parametrize("verify", [verify_closed_obstacle_contact, verify_invalid_obstacle_boxes,
                                  verify_obstacle_baseline_accounting, verify_obstacle_baseline_failures,
                                  verify_obstacle_conflicts_and_mapping])
def test_keep_out_invariants(verify):
    verify(solver)


@pytest.mark.parametrize("verify", [verify_fdm_axes_and_cubes, verify_fdm_constraints_change_removal,
                                  verify_fdm_float32_bound, verify_fdm_footprints_and_support_modes,
                                  verify_fdm_rounded_slice_height, verify_invalid_fdm_settings])
def test_fdm_invariants(verify):
    verify(solver)


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


def test_dense_source_simp_preserves_the_fixed_resolution_analytical_problem():
    mesh = trimesh.creation.box(extents=[10, 2, 2])
    for _ in range(6):
        mesh = mesh.subdivide()
    assert len(mesh.vertices) == 24578
    assert len(mesh.faces) == 49152
    request = request_for_box(1)
    request["mesh"] = {"vertices": mesh.vertices.ravel().tolist(), "indices": mesh.faces.ravel().tolist()}
    request["algorithm"] = {"kind": "simp", "volumeFraction": 0.8, "filterRadiusMm": 1.5, "penalty": 3}
    result = solver.solve(request)
    assert result["initialCellCount"] == 40
    assert result["sourceVolumeMm3"] == pytest.approx(40)
    assert result["baseline"]["maxVonMisesMpa"] == pytest.approx(2.5, rel=1e-9)
    assert result["baseline"]["maxDisplacementMm"] == pytest.approx(0.025, rel=1e-9)
    assert result["algorithm"]["densityIterations"] == 1
    assert output_mesh(result).volume == pytest.approx(result["optimized"]["volumeMm3"])
    region = solver._region({"kind": "surface", "triangleIndices": list(range(49152)), "depthMm": 1}, 49152)
    assert len(region["triangles"]) == 49152
    with pytest.raises(solver.SolverError) as error:
        solver._region({"kind": "surface", "triangleIndices": [49152], "depthMm": 1}, 49152)
    assert error.value.code == "invalid-input"


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


@pytest.mark.parametrize("fraction,target_count", [(0.96, 39), (0.95, 38), (1, 40)])
def test_stiffness_target_stops_at_conservative_retained_baseline_mass(fraction, target_count):
    request = request_for_box(4)
    request["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": fraction}
    result = solver.solve(request)
    assert result["initialCellCount"] == 40
    assert result["finalCellCount"] == target_count
    assert result["termination"] == "target-mass-reached"
    objective = result["objective"]
    assert objective["targetStatus"] == "reached"
    assert objective["targetCellCount"] == target_count
    assert objective["targetMassKg"] == pytest.approx(0.00004 * fraction)
    assert objective["achievedRetainedMassFraction"] == pytest.approx(target_count / 40)
    assert result["optimized"]["massKg"] >= objective["targetMassKg"]
    assert result["optimized"]["safetyFactor"] >= 2
    assert result["optimized"]["maxDisplacementMm"] <= 1
    assert result["optimized"]["cases"][0]["complianceNmm"] > 0
    assert output_mesh(result).volume == pytest.approx(target_count)
    assert result["sourceVolumeLossFraction"] == pytest.approx(0)
    assert not any("target not reached" in warning for warning in result["warnings"])


@pytest.mark.parametrize("blocker,termination", [("iterations", "iteration-limit"),
                                                  ("preserved", "no-removable-cells"),
                                                  ("topology", "constraints-or-topology"),
                                                  ("constraints", "constraints-or-topology")])
def test_stiffness_unreachable_targets_report_verified_remaining_mass(blocker, termination):
    request = request_for_box(4)
    fraction = 0.9 if blocker == "topology" else 0.1
    target_count = 36 if blocker == "topology" else 4
    request["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": fraction}
    if blocker == "iterations":
        request["maxIterations"] = 1
    elif blocker == "preserved":
        request["preserveRegions"] = [{"min": [-5, -1, -1], "max": [5, 1, 1]}]
    elif blocker == "constraints":
        request["maxDisplacementMm"] = 0.0250000001
    result = solver.solve(request)
    assert result["termination"] == termination
    objective = result["objective"]
    assert objective["targetStatus"] == "not-reached"
    assert objective["targetCellCount"] == target_count
    assert result["finalCellCount"] > target_count
    assert objective["achievedRetainedMassFraction"] == pytest.approx(result["optimized"]["massKg"] / result["baseline"]["massKg"])
    assert any("target not reached" in warning for warning in result["warnings"])
    assert result["optimized"]["safetyFactor"] >= request["safetyFactor"]
    assert result["optimized"]["maxDisplacementMm"] <= request["maxDisplacementMm"]
    assert output_mesh(result).volume == pytest.approx(result["optimized"]["volumeMm3"])


def test_zero_iterations_full_mass_target_is_already_reached():
    request = request_for_box(0)
    request["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": 1}
    result = solver.solve(request)
    assert result["objective"]["targetStatus"] == "reached"
    assert result["termination"] == "target-mass-reached"
    assert result["iterations"] == 0 and result["evaluations"] == 2
    assert result["optimized"] == result["baseline"]


def test_explicit_minimum_mass_preserves_the_legacy_default_result():
    request = request_for_box(4)
    legacy = solver.solve(request)
    request["objective"] = {"kind": "minimize-mass"}
    explicit = solver.solve(request)
    assert "objective" not in legacy
    assert explicit.pop("objective") == {"kind": "minimize-mass"}
    assert explicit == legacy


@pytest.mark.parametrize("objective", [None, {}, {"kind": "unknown"},
    {"kind": "minimize-mass", "retainedMassFraction": 0.5},
    {"kind": "maximize-stiffness"},
    {"kind": "maximize-stiffness", "retainedMassFraction": 0.099},
    {"kind": "maximize-stiffness", "retainedMassFraction": 1.001},
    {"kind": "maximize-stiffness", "retainedMassFraction": float("nan")},
    {"kind": "maximize-stiffness", "retainedMassFraction": float("inf")},
    {"kind": "maximize-stiffness", "retainedMassFraction": True},
    {"kind": "maximize-stiffness", "retainedMassFraction": 0.5, "targetMassKg": 1},
])
def test_invalid_objectives_are_rejected_at_the_python_boundary(objective):
    request = request_for_box()
    request["objective"] = objective
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "invalid-input"


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


@pytest.mark.parametrize("verify", [verify_rotated_surface_membership,
                                    verify_curved_surface_membership_and_preservation,
                                    verify_trimmed_surface_ties_and_missing_facets,
                                    verify_surface_boundary_freeze])
def test_surface_target_invariants(verify):
    verify(solver)


@pytest.mark.parametrize("region", [
    {"kind": "surface", "triangleIndices": [], "depthMm": 1},
    {"kind": "surface", "triangleIndices": [0, 0], "depthMm": 1},
    {"kind": "surface", "triangleIndices": [-1], "depthMm": 1},
    {"kind": "surface", "triangleIndices": [12], "depthMm": 1},
    {"kind": "surface", "triangleIndices": [True], "depthMm": 1},
    {"kind": "surface", "triangleIndices": [0.5], "depthMm": 1},
    {"kind": "surface", "triangleIndices": [0], "depthMm": 0},
    {"kind": "surface", "triangleIndices": [0], "depthMm": float("nan")},
    {"kind": "surface", "triangleIndices": [0], "depthMm": float("inf")},
    {"kind": "surface", "triangleIndices": [0], "depthMm": 1, "faceId": "transient"},
])
def test_invalid_surface_regions_fail_at_the_python_boundary(region):
    request = request_for_box()
    request["supports"] = [region]
    with pytest.raises(solver.SolverError) as error:
        solver.solve(request)
    assert error.value.code == "invalid-input"


def test_simp_optimization_and_unreachable_target():
    verify_simp_search(solver)


def test_simp_true_penalized_fem_derivative_filter_and_oc_bounds():
    verify_penalized_fem_and_sensitivity(solver)


@pytest.mark.parametrize("lattice,field,skin", [("gyroid", "strain-energy", 0), ("schwarz-p", "von-mises", 0), ("schwarz-d", "strain-energy", 0), ("gyroid", "von-mises", 1)])
def test_fem_graded_tpms_solid(lattice, field, skin):
    verify_lattice_search(solver, lattice, field, skin)


def test_implicit_algorithm_failures():
    verify_implicit_failures(solver)


@pytest.mark.parametrize("kind", ["simp", "adaptive-lattice"])
def test_implicit_deadline_during_search(kind, monkeypatch):
    original = solver._algorithm_search
    def expired(*args, **kwargs):
        # Expire after voxelization and baseline analysis, inside the search.
        values = list(args); values[-1] = time.monotonic() - 1
        return original(*values, **kwargs)
    monkeypatch.setattr(solver, "_algorithm_search", expired)
    with pytest.raises(solver.SolverError) as failure:
        solver.solve(implicit_request(solver, kind))
    assert failure.value.code == "resource-limit"


def test_cavity_shells_accept_one_material_solid_and_reject_separate_or_nested_material():
    outer = trimesh.creation.box(extents=[10, 8, 8])
    cavity = trimesh.creation.box(extents=[2, 2, 2]); cavity.invert()
    hollow = trimesh.util.concatenate([outer, cavity])
    solver._check_surface(hollow, "Hollow fixture", time.monotonic() + 60)
    cavity.apply_translation([20, 0, 0])
    with pytest.raises(solver.SolverError):
        solver._check_surface(trimesh.util.concatenate([outer, cavity]), "External cavity")
    inner = trimesh.creation.box(extents=[1, 1, 1])
    with pytest.raises(solver.SolverError) as failure:
        solver._check_surface(trimesh.util.concatenate([outer, inner]), "Separate material")
    assert failure.value.code == "disconnected-mesh"
    cavity = trimesh.creation.box(extents=[4, 4, 4]); cavity.invert()
    inner.invert()
    with pytest.raises(solver.SolverError):
        solver._check_surface(trimesh.util.concatenate([outer, cavity, inner]), "Nested cavities")


@pytest.mark.parametrize("kind", ["simp", "adaptive-lattice"])
def test_implicit_keepout_fdm_and_all_case_constraints(kind):
    verify_implicit_constraints(solver, kind)


def test_simp_filter_resource_budget():
    cells = np.array(list(itertools.product(range(10), repeat=3)))
    with pytest.raises(solver.SolverError) as failure:
        solver._sensitivity_filter(cells, 100000, time.monotonic() + 60)
    assert failure.value.code == "resource-limit"


@pytest.mark.parametrize("budget", [1, 3])
def test_lattice_baseline_fallback_respects_search_budget(budget):
    from implicit_fixtures import verify_lattice_baseline_fallback
    verify_lattice_baseline_fallback(solver, budget)


def test_shell_intersection_directions_subcell_notches_and_coplanar_contacts():
    from implicit_fixtures import verify_shell_intersections
    verify_shell_intersections(solver)


def test_skinny_disjoint_cavities_and_unresolved_barycentrics():
    from implicit_fixtures import verify_skinny_cavity_separation
    verify_skinny_cavity_separation(solver)
