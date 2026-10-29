"""Shared native and pinned-WASM evidence for coupled loads and relative limits."""

import copy
import itertools
import json
import math

import numpy as np
import trimesh


def _compound_request():
    source = trimesh.creation.box(extents=[8, 4, 4])
    source.apply_translation([4, 2, 2])
    return {
        "schemaVersion": 1,
        "mesh": {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0.35,
                     "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2, "maxDisplacementMm": 1, "cellSizeMm": 1,
        "supports": [{"min": [0, 0, 0], "max": [0, 4, 4]}],
        "loadCases": [{"name": "torque", "region": {"min": [8, 0, 0], "max": [8, 1, 4]},
                       "forceN": [0, 0, -0.5], "additionalLoads": [
                           {"region": {"min": [8, 3, 0], "max": [8, 4, 4]}, "forceN": [0, 0, 0.5]}]}],
        "preserveRegions": [], "maxIterations": 0,
    }


def _expect_rejection(solver, request, code):
    response = json.loads(solver.solve_json(json.dumps(request)))
    assert not response["ok"], response
    assert response["error"]["code"] == code, response


def verify_compound_superposition_and_protection(solver):
    request = _compound_request()
    namespace = solver._evaluate.__globals__
    original = namespace["fem_solve"]
    observed = []

    def observe(matrix, force, prescribed, free, **options):
        displacement = original(matrix, force, prescribed, free, **options)
        full_force = np.zeros_like(displacement)
        full_force[free] = force
        observed.append((full_force, displacement.copy()))
        return displacement

    try:
        namespace["fem_solve"] = observe
        result = solver.solve(request)
        assert len(observed) == 2, "One compound case must use one RHS per baseline/final solve."
        combined_force, combined_displacement = observed[0]
        observed.clear()
        primary = copy.deepcopy(request)
        secondary_term = primary["loadCases"][0].pop("additionalLoads")[0]
        solver.solve(primary)
        first_force, first_displacement = observed[0]
        observed.clear()
        secondary = copy.deepcopy(request)
        secondary["loadCases"] = [{"name": "secondary", **secondary_term}]
        solver.solve(secondary)
        second_force, second_displacement = observed[0]
    finally:
        namespace["fem_solve"] = original

    assert np.allclose(combined_force, first_force + second_force, rtol=1e-12, atol=1e-14)
    assert np.linalg.norm(combined_displacement - first_displacement - second_displacement) <= 1e-8 * np.linalg.norm(combined_displacement)
    cells = np.array(list(itertools.product(range(8), range(4), range(4))))
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    nodal_force = combined_force.reshape(-1, 3)
    assert np.linalg.norm(nodal_force.sum(axis=0)) < 1e-12
    assert np.allclose(np.cross(mesh.p.T, nodal_force).sum(axis=0), [1.5, 0, 0], atol=1e-12)
    assert len(result["baseline"]["cases"]) == 1
    assert abs(result["baseline"]["cases"][0]["complianceNmm"] / (combined_force @ combined_displacement) - 1) < 1e-12

    source, _, _ = solver._source(request, 1)
    fixed, loads, protected = solver._conditions(request, mesh, nodes, cells, 1, source, None)
    primary_protected = solver._conditions(primary, mesh, nodes, cells, 1, source, None)[2]
    secondary_protected = solver._conditions(secondary, mesh, nodes, cells, 1, source, None)[2]
    assert protected == primary_protected | secondary_protected
    assert secondary_protected - primary_protected
    reduced = cells[~np.all(cells == [7, 3, 1], axis=1)]
    try:
        solver._evaluate(reduced, np.zeros(3), 1, (1000, 0.35, 100), fixed, loads, 1000, None)
        raise AssertionError("Losing an additional loaded facet must reject the candidate.")
    except solver.SolverError as error:
        assert error.code == "boundary-condition-lost"


def verify_invalid_compound_loads(solver):
    term = _compound_request()["loadCases"][0]["additionalLoads"][0]
    for invalid in (None, [], {}, [None], [{**term, "name": "extra"}],
                    [{**term, "forceN": [0, 0, 0]}], [{**term, "forceN": [0, 0, True]}],
                    [{**term, "forceN": [0, 0, float("nan")]}],
                    [{**term, "region": {"kind": "surface", "triangleIndices": [999], "depthMm": 1}}]):
        request = _compound_request()
        request["loadCases"][0]["additionalLoads"] = invalid
        _expect_rejection(solver, request, "invalid-input")
    for region, code in (({"min": [9, 0, 0], "max": [9, 4, 4]}, "no-load-facets"),
                         ({"min": [0, 0, 0], "max": [0, 4, 4]}, "load-support-overlap")):
        request = _compound_request()
        request["loadCases"][0]["additionalLoads"][0]["region"] = region
        _expect_rejection(solver, request, code)
    request = _compound_request()
    request["obstacleRegions"] = [{"min": [7.2, 3.2, 1.2], "max": [7.8, 3.8, 1.8]}]
    _expect_rejection(solver, request, "invalid-input")
    request = _compound_request()
    request["loadCases"][0]["additionalLoads"][0] = {
        "region": request["loadCases"][0]["region"], "forceN": [0, 0, 0.5]}
    _expect_rejection(solver, request, "numerical-failure")


def _relative_request():
    request = _compound_request()
    request["loadCases"] = [
        {"name": "dominant", "region": {"min": [8, 0, 0], "max": [8, 4, 4]}, "forceN": [1, 0, 0]},
        {"name": "small", "region": {"min": [8, 0, 0], "max": [8, 4, 4]}, "forceN": [1e-8, 0, 0]},
    ]
    request["material"]["poissonRatio"] = 0
    request["maxIterations"] = 8
    request["relativePerformance"] = {"minStiffnessFraction": 0.5, "minStrengthFraction": 0.5}
    return request


def verify_relative_candidate_gates(solver, metric, algorithm):
    request = _relative_request()
    if algorithm:
        request["algorithm"] = {"kind": "simp", "volumeFraction": 0.1, "filterRadiusMm": 1.5, "penalty": 3}
    namespace = solver.solve.__globals__
    original = namespace["_evaluate"]
    initial_count = 8 * 4 * 4
    reference = None
    candidates = []

    def violate_small_case(cells, *args, **options):
        nonlocal reference
        metrics, energy, surface = original(cells, *args, **options)
        if len(cells) == initial_count and options.get("relative_modulus") is None:
            reference = copy.deepcopy(metrics)
        elif options.get("relative_modulus") is None:
            candidates.append(len(cells))
            # Inject controlled responses after a real binary FEM solve to
            # isolate per-case acceptance from voxel-corner stress peaks.
            for case, baseline_case in zip(metrics["cases"], reference["cases"]):
                case["complianceNmm"] = baseline_case["complianceNmm"] * 1.1
                case["maxVonMisesMpa"] = baseline_case["maxVonMisesMpa"] * 1.1
                case["safetyFactor"] = 100 / case["maxVonMisesMpa"]
            metrics["cases"][1][metric] = reference["cases"][1][metric] * 2.01
            if metric == "maxVonMisesMpa":
                metrics["cases"][1]["safetyFactor"] = 100 / metrics["cases"][1][metric]
            # The dominant case and every absolute bound still permit removal.
            assert metrics["cases"][1][metric] < reference["cases"][0][metric]
            metrics["maxVonMisesMpa"] = max(case["maxVonMisesMpa"] for case in metrics["cases"])
            metrics["safetyFactor"] = min(case["safetyFactor"] for case in metrics["cases"])
        return metrics, energy, surface

    try:
        namespace["_evaluate"] = violate_small_case
        constrained = solver.solve(request)
        assert candidates, "The relative gate must actually encounter a removable candidate."
        assert constrained["finalCellCount"] == initial_count
        assert constrained["relativePerformance"] == request["relativePerformance"]
        del request["relativePerformance"]
        legacy = solver.solve(request)
        assert legacy["finalCellCount"] < initial_count
        assert "relativePerformance" not in legacy
    finally:
        namespace["_evaluate"] = original


def verify_relative_final_gate(solver, metric, baseline_value):
    request = _relative_request()
    request["maxIterations"] = 0
    namespace = solver.solve.__globals__
    original = namespace["_evaluate"]
    calls = 0

    def altered_final(*args, **options):
        nonlocal calls
        metrics, energy, surface = original(*args, **options)
        calls += 1
        metrics["cases"][1][metric] = baseline_value * (1 if calls == 1 else 2.01)
        return metrics, energy, surface

    try:
        namespace["_evaluate"] = altered_final
        _expect_rejection(solver, request, "final-verification-failed" if baseline_value > 0 else "numerical-failure")
    finally:
        namespace["_evaluate"] = original


def verify_relative_full_solid_search(solver, algorithm):
    request = _relative_request()
    request["relativePerformance"] = {"minStiffnessFraction": 1, "minStrengthFraction": 1}
    if algorithm:
        request["algorithm"] = {"kind": "simp", "volumeFraction": 0.1, "filterRadiusMm": 1.5, "penalty": 3}
    constrained = solver.solve(request)
    assert constrained["optimized"] == constrained["baseline"]
    assert constrained["initialCellCount"] == constrained["finalCellCount"]
    assert constrained["relativePerformance"] == request["relativePerformance"]
    del request["relativePerformance"]
    legacy = solver.solve(request)
    assert legacy["finalCellCount"] < legacy["initialCellCount"]
    assert "relativePerformance" not in legacy


def verify_invalid_relative_settings(solver):
    for invalid in (None, {}, {"minStiffnessFraction": 0.9},
                    {"minStiffnessFraction": 0, "minStrengthFraction": 1},
                    {"minStiffnessFraction": 1, "minStrengthFraction": 1.01},
                    {"minStiffnessFraction": True, "minStrengthFraction": 1},
                    {"minStiffnessFraction": float("nan"), "minStrengthFraction": 1},
                    {"minStiffnessFraction": 1, "minStrengthFraction": 1, "extra": 1}):
        request = _relative_request()
        request["relativePerformance"] = invalid
        _expect_rejection(solver, request, "invalid-input")


def verify_relaxed_failure_contract(solver, successful_iterations, code):
    request = _compound_request()
    request["maxIterations"] = 4
    request["algorithm"] = {"kind": "simp", "volumeFraction": 0.5, "filterRadiusMm": 1.5, "penalty": 3}
    request["relativePerformance"] = {"minStiffnessFraction": 0.5, "minStrengthFraction": 0.5}
    namespace = solver.solve.__globals__
    original = namespace["_evaluate"]
    density_calls = 0
    solid_calls = 0

    def fail_relaxed(cells, *args, **options):
        nonlocal density_calls, solid_calls
        if options.get("relative_modulus") is not None:
            density_calls += 1
            if density_calls > successful_iterations:
                raise solver.SolverError(code, "Injected relaxed-iterate failure.")
        else:
            solid_calls += 1
        return original(cells, *args, **options)

    try:
        namespace["_evaluate"] = fail_relaxed
        if code != "numerical-failure":
            _expect_rejection(solver, request, code)
            assert solid_calls == 1
            return
        result = solver.solve(request)
    finally:
        namespace["_evaluate"] = original
    assert density_calls == successful_iterations + 1
    assert result["iterations"] == density_calls == result["algorithm"]["densityIterations"]
    assert result["algorithm"]["converged"] is False
    assert result["algorithm"]["projectionEvaluations"] <= request["maxIterations"] + 1
    assert result["evaluations"] == solid_calls + density_calls
    assert solid_calls >= 3, "Fallback must analyze binary candidates and repeat the final solve."
    assert any("stopped after a numerical failure" in warning for warning in result["warnings"])
    assert result["optimized"]["safetyFactor"] >= request["safetyFactor"]
    assert result["optimized"]["maxDisplacementMm"] <= request["maxDisplacementMm"]
    for case, baseline in zip(result["optimized"]["cases"], result["baseline"]["cases"]):
        assert case["complianceNmm"] <= baseline["complianceNmm"] / 0.5
        assert case["maxVonMisesMpa"] <= baseline["maxVonMisesMpa"] / 0.5


def verify_protected_density_floor_fallback(solver):
    request = _compound_request()
    request["maxIterations"] = 8
    request["algorithm"] = {"kind": "simp", "volumeFraction": 0.1, "filterRadiusMm": 1.5, "penalty": 3}
    request["relativePerformance"] = {"minStiffnessFraction": 0.5, "minStrengthFraction": 0.5}
    request["preserveRegions"] = [{"min": [0, 0, 0], "max": [3.1, 4, 4]}]
    cells = np.array(list(itertools.product(range(8), range(4), range(4))))
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    source, _, _ = solver._source(request, 1)
    _, _, protected = solver._conditions(request, mesh, nodes, cells, 1, source, None)
    assert math.ceil(len(cells) * 0.1) < len(protected) < len(cells)
    namespace = solver.solve.__globals__
    original = namespace["_evaluate"]
    baseline_energy, candidates = None, []

    def observe(candidate, *args, **options):
        nonlocal baseline_energy
        assert options.get("relative_modulus") is None, "An unavailable density budget must never run a relaxed FEM solve."
        if len(candidate) < len(cells):
            candidates.append(candidate.copy())
        result = original(candidate, *args, **options)
        if baseline_energy is None:
            baseline_energy = {tuple(cell): float(value) for cell, value in zip(candidate, result[1])}
        return result

    try:
        namespace["_evaluate"] = observe
        result = solver.solve(request)
    finally:
        namespace["_evaluate"] = original
    evidence = result["algorithm"]
    assert evidence["densityIterations"] == result["iterations"] == 0
    assert evidence["converged"] is False and evidence["targetStatus"] == "not-reached"
    assert result["evaluations"] == 2 + evidence["projectionEvaluations"]
    assert any("no adjustable density budget" in warning for warning in result["warnings"])
    assert candidates
    for candidate in candidates:
        retained = {tuple(cell) for cell in candidate}
        kept = [value for cell, value in baseline_energy.items() if cell in retained and cell not in protected]
        removed = [value for cell, value in baseline_energy.items() if cell not in retained]
        if kept and removed:
            assert min(kept) >= max(removed), "Binary fallback must rank verified energy, not floating ties in a constant density field."
    for case, baseline in zip(result["optimized"]["cases"], result["baseline"]["cases"]):
        assert case["complianceNmm"] <= baseline["complianceNmm"] / 0.5
        assert case["maxVonMisesMpa"] <= baseline["maxVonMisesMpa"] / 0.5

    request["preserveRegions"] = [{"min": [0, 0, 0], "max": [8, 4, 4]}]
    frozen = solver.solve(request)
    assert frozen["termination"] == "no-removable-cells"
    assert frozen["finalCellCount"] == frozen["initialCellCount"]
    assert frozen["algorithm"]["densityIterations"] == 0 and not frozen["algorithm"]["converged"]
    assert frozen["algorithm"]["targetStatus"] == "not-reached"
    request["algorithm"]["volumeFraction"] = 1
    full = solver.solve(request)
    assert full["algorithm"]["targetStatus"] == "reached"
    assert not any("no adjustable density budget" in warning for warning in full["warnings"])


def verify_final_voxel_grid_evidence(solver):
    request = _relative_request()
    request["maxIterations"] = 2
    request["includeVoxelGrid"] = True
    namespace = solver.solve.__globals__
    original = namespace["_evaluate"]
    verified = []

    def observe(cells, origin, spacing, *args, **options):
        result = original(cells, origin, spacing, *args, **options)
        if options.get("relative_modulus") is None:
            verified.append((cells.copy(), origin.copy(), spacing))
        return result

    try:
        namespace["_evaluate"] = observe
        result = solver.solve(request)
    finally:
        namespace["_evaluate"] = original
    cells, origin, spacing = verified[-1]
    grid = result["voxelGrid"]
    assert grid["cells"] == cells.tolist()
    assert grid["originMm"] == origin.tolist() == [0, 0, 0]
    assert grid["cellSizeMm"] == spacing == request["cellSizeMm"]
    assert len(grid["cells"]) == len({tuple(cell) for cell in grid["cells"]}) == result["finalCellCount"]
    assert all(type(index) is int and index >= 0 for cell in grid["cells"] for index in cell)
    surface = trimesh.Trimesh(np.array(result["mesh"]["vertices"]).reshape(-1, 3),
                              np.array(result["mesh"]["indices"]).reshape(-1, 3), process=False)
    assert abs(surface.volume - len(cells) * spacing ** 3) < 1e-8
    assert result["optimized"]["volumeMm3"] == len(cells) * spacing ** 3
    del request["includeVoxelGrid"]
    assert "voxelGrid" not in solver.solve(request)
    request["includeVoxelGrid"] = False
    assert "voxelGrid" not in solver.solve(request)


def verify_reconstructed_grid_phase(solver):
    request = _relative_request()
    request["maxIterations"] = 0
    request["includeVoxelGrid"] = True
    source = np.array(request["mesh"]["vertices"]).reshape(-1, 3)
    source[source[:, 1] == 0, 1] = 0.25
    request["mesh"]["vertices"] = source.ravel().tolist()
    legacy = solver.solve(request)
    assert legacy["voxelGrid"]["originMm"] == [0, 0.25, 0]
    request["voxelGridOriginMm"] = [0, 0, 0]
    aligned = solver.solve(request)
    assert aligned["voxelGrid"]["originMm"] == [0, 0, 0]
    assert all(cell[1] >= 1 for cell in aligned["voxelGrid"]["cells"])
    assert aligned["finalCellCount"] == 8 * 3 * 4
    assert min(aligned["mesh"]["vertices"][1::3]) == 1
    request["voxelGridOriginMm"] = [100, -100, 100]
    equivalent = solver.solve(request)
    assert equivalent["voxelGrid"] == aligned["voxelGrid"]
    assert equivalent["optimized"] == aligned["optimized"]
    request["voxelGridOriginMm"] = [1e-10, 0, 0]
    snapped = solver.solve(request)
    assert snapped["voxelGrid"]["originMm"] == [1e-10, 0, 0]
    assert snapped["finalCellCount"] == aligned["finalCellCount"]

    boundary = _relative_request()
    boundary["maxIterations"] = 0
    boundary["includeVoxelGrid"] = True
    vertices = np.array(boundary["mesh"]["vertices"]).reshape(-1, 3)
    vertices[:, 1] -= 100000
    boundary["mesh"]["vertices"] = vertices.ravel().tolist()
    for region in boundary["supports"] + [case["region"] for case in boundary["loadCases"]]:
        region["min"][1] -= 100000
        region["max"][1] -= 100000
    boundary["voxelGridOriginMm"] = [0, -99999.5, 0]
    edge = solver.solve(boundary)
    assert edge["voxelGrid"]["originMm"] == [0, -100000.5, 0]
    boundary["voxelGridOriginMm"] = edge["voxelGrid"]["originMm"]
    assert solver.solve(boundary)["voxelGrid"] == edge["voxelGrid"]


def verify_invalid_voxel_grid_inputs(solver):
    for flag in (None, 1, 0, "true", []):
        request = _relative_request()
        request["includeVoxelGrid"] = flag
        _expect_rejection(solver, request, "invalid-input")
    for phase in (None, [], [0, 0], [0, 0, True], [0, 0, float("nan")],
                  [0, 0, float("inf")], [0, 0, 200001]):
        request = _relative_request()
        request["voxelGridOriginMm"] = phase
        _expect_rejection(solver, request, "invalid-input")
