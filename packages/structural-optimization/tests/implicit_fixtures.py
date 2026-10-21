"""Shared native and pinned-WASM evidence for density and graded-cell searches."""
import copy
import itertools
import json
import time

import numpy as np
import trimesh


def implicit_request(solver, kind="simp", iterations=6, lattice="gyroid"):
    extents = (10, 2, 2) if kind == "simp" else (10, 8, 8)
    cells = np.array(list(itertools.product(*(range(n) for n in extents))))
    source = solver._surface(solver._hex_mesh(cells, np.zeros(3), 1)[0])
    request = {
        "schemaVersion": 1,
        "mesh": {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0, "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2, "maxDisplacementMm": 1, "cellSizeMm": 1,
        "supports": [{"min": [0, 0, 0], "max": [0, extents[1], extents[2]]}],
        "loadCases": [{"name": "axial", "region": {"min": [extents[0], 0, 0], "max": list(extents)}, "forceN": [1, 0, 0]},
                      {"name": "bending", "region": {"min": [extents[0], 0, 0], "max": list(extents)}, "forceN": [0, 0, 0.1]}],
        "preserveRegions": [], "maxIterations": iterations,
    }
    request["algorithm"] = ({"kind": "simp", "volumeFraction": 0.8, "filterRadiusMm": 1.5, "penalty": 3} if kind == "simp" else
                            {"kind": "adaptive-lattice", "lattice": lattice, "cellPeriodMm": 12,
                             "minWallThicknessMm": 2, "maxWallThicknessMm": 3, "skinThicknessMm": 0,
                             "field": "strain-energy", "gamma": 1})
    return request


def implicit_expect_code(solver, request, code):
    response = json.loads(solver.solve_json(json.dumps(request)))
    assert not response["ok"], response
    assert response["error"]["code"] == code, response


def verify_implicit_solid(solver, request, result):
    mesh = trimesh.Trimesh(np.array(result["mesh"]["vertices"]).reshape(-1, 3),
                           np.array(result["mesh"]["indices"]).reshape(-1, 3), process=False)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume
    assert abs(mesh.volume - result["optimized"]["volumeMm3"]) < 1e-8
    assert abs(mesh.volume - result["finalCellCount"] * request["cellSizeMm"] ** 3) < 1e-8
    assert result["algorithm"]["settings"] == request["algorithm"]
    assert len(result["optimized"]["cases"]) == len(request["loadCases"])
    for case in result["optimized"]["cases"]:
        assert case["safetyFactor"] >= request["safetyFactor"]
        assert case["maxDisplacementMm"] <= request["maxDisplacementMm"]
    # Exact authored support and traction interfaces remain present.
    for x in (0, 10):
        triangles = mesh.triangles[np.all(np.isclose(mesh.triangles[:, :, 0], x), axis=1)]
        expected = 4 if request["algorithm"]["kind"] == "simp" else 64
        assert abs(trimesh.triangles.area(triangles).sum() - expected) < 1e-8
    return mesh


def verify_simp_search(solver):
    request = implicit_request(solver)
    result = solver.solve(request)
    verify_implicit_solid(solver, request, result)
    evidence = result["algorithm"]
    assert result["finalCellCount"] < result["initialCellCount"]
    assert evidence["densityIterations"] > 0
    assert evidence["projectionEvaluations"] > 0
    assert evidence["targetCellCount"] == 32
    assert evidence["achievedCellCount"] == result["finalCellCount"]
    assert evidence["converged"] == (evidence["maxDensityChange"] <= 0.01)
    assert (evidence["targetStatus"] == "reached") == (result["finalCellCount"] == 32)
    # Protected volume makes the binary target unattainable, even if relaxed
    # densities converge. Its full-solid metrics must still be feasible.
    request["preserveRegions"] = [{"min": [0, 0, 0], "max": [10, 2, 2]}]
    result = solver.solve(request)
    assert result["algorithm"]["targetStatus"] == "not-reached"
    assert result["finalCellCount"] == 40
    assert result["optimized"] == result["baseline"]
    request["algorithm"]["volumeFraction"] = 1
    result = solver.solve(request)
    assert result["algorithm"]["targetStatus"] == "reached"


def verify_penalized_fem_and_sensitivity(solver):
    request = implicit_request(solver, iterations=0)
    request["loadCases"] = request["loadCases"][:1]
    cells = np.array(list(itertools.product(range(10), range(2), range(2))))
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    source, _origin, _volume = solver._source(request, 1)
    deadline = time.monotonic() + 60
    fixed, loads, _protected = solver._conditions(request, mesh, nodes, cells, 1, source, deadline)
    def evaluate(rho):
        return solver._evaluate(cells, np.zeros(3), 1, (1000, 0, 100), fixed, loads, 1000,
                                deadline, relative_modulus=1e-6 + (1 - 1e-6) * rho ** 3, sum_cases=True)
    rho = np.full(len(cells), 0.7)
    result, energy, _ = evaluate(rho)
    compliance = result["cases"][0]["complianceNmm"]
    expected = 0.0025 / (1e-6 + (1 - 1e-6) * 0.7 ** 3)
    assert abs(compliance / expected - 1) < 1e-9
    # True dC/drho, checked independently by a centered FEM perturbation.
    step = 1e-5
    plus, minus = rho.copy(), rho.copy()
    plus[10] += step
    minus[10] -= step
    finite_difference = (evaluate(plus)[0]["cases"][0]["complianceNmm"] - evaluate(minus)[0]["cases"][0]["complianceNmm"]) / (2 * step)
    derivative = -3 * (1 - 1e-6) * rho[10] ** 2 * energy[10] / (1e-6 + (1 - 1e-6) * rho[10] ** 3)
    assert abs(finite_difference / derivative - 1) < 1e-6
    matrix, sums = solver._sensitivity_filter(cells, 1.5, deadline)
    signal = np.zeros(len(cells)); signal[10] = 1
    filtered = matrix @ signal / sums
    assert 0 < filtered[10] < 1 and np.count_nonzero(filtered) > 1
    frozen = np.zeros(len(cells), dtype=bool); frozen[:4] = True
    rho[frozen] = 1
    updated = solver._oc_update(rho, -np.ones(len(cells)), frozen, 25)
    assert np.all(updated[frozen] == 1) and np.max(np.abs(updated - rho)) <= 0.2 + 1e-12
    assert updated.sum() <= 25 + 1e-8


def verify_lattice_search(solver, lattice="gyroid", field="strain-energy", skin=0):
    request = implicit_request(solver, "adaptive-lattice", lattice=lattice)
    request["algorithm"].update(field=field, skinThicknessMm=skin)
    # Make bending dominate the baseline grading rather than uniform axial stress.
    request["loadCases"][0]["forceN"] = [0.01, 0, 0]
    request["loadCases"][1]["forceN"] = [0, 0, 1]
    result = solver.solve(request)
    mesh = verify_implicit_solid(solver, request, result)
    evidence = result["algorithm"]
    assert evidence["fieldMin"] < evidence["fieldMax"]
    assert evidence["requestedWallMinMm"] < evidence["requestedWallMaxMm"]
    assert evidence["minimumFeatureSizeBoundMm"] >= 2
    assert result["finalCellCount"] < result["initialCellCount"]
    rounded = mesh.vertices.astype(np.float32).astype(float)
    assert abs(trimesh.Trimesh(rounded, mesh.faces, process=False).volume - mesh.volume) < 1e-8
    return request, result


def verify_implicit_failures(solver):
    for kind in ("simp", "adaptive-lattice"):
        request = implicit_request(solver, kind, iterations=0)
        result = solver.solve(request)
        assert result["status"] == "no-improvement" and result["optimized"] == result["baseline"]
        bad = copy.deepcopy(request)
        bad["algorithm"]["unexpected"] = 1
        implicit_expect_code(solver, bad, "invalid-input")
        bad = copy.deepcopy(request)
        bad["mesh"]["indices"][0] = bad["mesh"]["indices"][1]
        implicit_expect_code(solver, bad, "invalid-mesh")
        bad = copy.deepcopy(request)
        bad["maxDisplacementMm"] = 1e-9
        implicit_expect_code(solver, bad, "infeasible-baseline")
    request = implicit_request(solver)
    request["objective"] = {"kind": "maximize-stiffness", "retainedMassFraction": 0.9}
    implicit_expect_code(solver, request, "invalid-input")
    for key, value in (("cellPeriodMm", 7), ("minWallThicknessMm", 1.9), ("maxWallThicknessMm", 7), ("skinThicknessMm", 0.5)):
        request = implicit_request(solver, "adaptive-lattice")
        request["algorithm"][key] = value
        implicit_expect_code(solver, request, "invalid-input")
    # A larger period does not permit a thin one-cell source to masquerade as
    # a resolved sheet: geometry itself must pass complete cube coverage.
    request = implicit_request(solver)
    request["algorithm"] = implicit_request(solver, "adaptive-lattice")["algorithm"]
    request["algorithm"].update(minWallThicknessMm=3, maxWallThicknessMm=3)
    implicit_expect_code(solver, request, "infeasible-baseline")


def verify_implicit_constraints(solver, kind):
    request = implicit_request(solver, kind)
    request["obstacleRegions"] = [{"min": [4.1, 1.1, 1.1] if kind == "simp" else [4.1, 3.1, 3.1],
                                   "max": [4.2, 1.2, 1.2] if kind == "simp" else [4.2, 3.2, 3.2]}]
    request["fdm"] = {"buildDirection": "+z", "supportMode": "allowed", "minFeatureSizeMm": 1 if kind == "simp" else 2,
                      "layerHeightMm": 0.2, "maxOverhangAngleDeg": 45}
    result = solver.solve(request)
    mesh = verify_implicit_solid(solver, request, result)
    assert result["fdm"]["optimized"]["minFeatureSizeBoundMm"] >= request["fdm"]["minFeatureSizeMm"]
    # No exported triangle AABB may even touch the closed obstacle box.
    lo = np.array(request["obstacleRegions"][0]["min"])
    hi = np.array(request["obstacleRegions"][0]["max"])
    overlaps = np.all((mesh.triangles.min(axis=1) <= hi) & (mesh.triangles.max(axis=1) >= lo), axis=1)
    assert not np.any(overlaps)
    # Final metrics agree with a fresh no-optimization solve of the emitted solid.
    repeat = copy.deepcopy(request)
    repeat["mesh"] = result["mesh"]
    repeat["maxIterations"] = 0
    repeat.pop("algorithm")
    repeat.pop("obstacleRegions")
    verified = solver.solve(repeat)
    for actual, expected in zip(verified["optimized"]["cases"], result["optimized"]["cases"]):
        for key in ("maxVonMisesMpa", "maxDisplacementMm", "complianceNmm"):
            assert abs(actual[key] / expected[key] - 1) < 1e-7


def verify_lattice_baseline_fallback(solver, budget=1):
    request = implicit_request(solver, "adaptive-lattice", iterations=0)
    baseline = solver.solve(request)
    request["maxIterations"] = budget
    request["maxDisplacementMm"] = baseline["optimized"]["maxDisplacementMm"] * (1 + 1e-7)
    result = solver.solve(request)
    assert result["status"] == "no-improvement"
    assert result["finalCellCount"] == result["initialCellCount"]
    assert result["iterations"] == result["algorithm"]["thresholdPasses"] <= budget
    assert result["algorithm"]["projectionEvaluations"] <= budget
    verify_implicit_solid(solver, request, result)
    return request, result


def verify_shell_intersections(solver):
    for subcell in (False, True):
        cells = np.array([p for p in itertools.product(range(14), repeat=3)
                          if not (p[0] == 4 and p[1] == 7 and p[2] >= 10)])
        outer = solver._surface(solver._hex_mesh(cells, np.zeros(3), 1)[0])
        if subcell:
            outer.vertices[:, 0] = np.interp(outer.vertices[:, 0], [0, 4, 5, 14], [0, 4.1, 4.2, 14])
            outer.vertices[:, 1] = np.interp(outer.vertices[:, 1], [0, 7, 8, 14], [0, 7.1, 7.2, 14])
        cavity = trimesh.creation.box(extents=[10, 10, 10])
        cavity.apply_translation([7, 7, 7]); cavity.invert()
        source = trimesh.util.concatenate([outer, cavity])
        request = implicit_request(solver, iterations=0)
        request.pop("algorithm")
        request["mesh"] = {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()}
        request["supports"] = [{"min": [0, 0, 0], "max": [0, 14, 14]}]
        request["loadCases"] = [{"name": "axial", "region": {"min": [14, 0, 0], "max": [14, 14, 14]}, "forceN": [1, 0, 0]}]
        implicit_expect_code(solver, request, "invalid-mesh")
    outer = trimesh.creation.box(extents=[14, 14, 14]); outer.apply_translation([7, 7, 7])
    cavities = []
    for center in ([4, 4, 4], [10, 10, 10]):
        cavity = trimesh.creation.box(extents=[2, 2, 2]); cavity.apply_translation(center); cavity.invert()
        cavities.append(cavity)
    solver._check_surface(trimesh.util.concatenate([outer] + cavities), "Disjoint enclosed cavities", time.monotonic() + 60)
    touching = trimesh.creation.box(extents=[2, 2, 2]); touching.apply_translation([13, 7, 7]); touching.invert()
    try:
        solver._check_surface(trimesh.util.concatenate([outer, touching]), "Coplanar outer contact", time.monotonic() + 60)
    except solver.SolverError as error:
        assert error.code == "invalid-mesh"
    else:
        raise AssertionError("Touching shells must fail")
    triangle = trimesh.Trimesh(vertices=[[0, 0, 0], [2, 0, 0], [1, 2, 0]], faces=[[0, 1, 2]], process=False)
    rays = solver._RayIntersector(triangle)
    # Both endpoints lie outside this triangle; the coplanar edge crosses it.
    assert solver._coplanar_edge_contact(np.array([[0, 1.5, 0], [2, 1.5, 0]]), triangle, rays)
    assert not solver._coplanar_edge_contact(np.array([[3, 3, 0], [4, 3, 0]]), triangle, rays)


def verify_skinny_cavity_separation(solver):
    outer = trimesh.creation.box(extents=[14, 14, 14])
    cavities = []
    for offset in (0, 0.001):
        cavity = trimesh.creation.box(extents=[10, 1e-7, 2])
        cavity.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 4, [0, 0, 1]))
        cavity.apply_translation([-offset, offset, 0]); cavity.invert()
        cavities.append(cavity)
    source = trimesh.util.concatenate([outer] + cavities)
    request = {"mesh": {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()}}
    normalized, _origin, volume = solver._source(request, 1, time.monotonic() + 60)
    rays = solver._RayIntersector(cavities[1])
    # Require finite arithmetic specifically in the repaired clipping path;
    # Trimesh's separate ray primitive retains its own numerical behavior.
    with np.errstate(all="raise"):
        for edge in cavities[0].vertices[cavities[0].edges_unique]:
            assert not solver._coplanar_edge_contact(edge, cavities[1], rays)
    assert np.all(np.isfinite(normalized.vertices))
    assert abs(volume - 2743.999996) < 1e-8
    triangle = trimesh.Trimesh(vertices=[[0, 0, 0], [2, 0, 0], [1, 2, 0]], faces=[[0, 1, 2]], process=False)
    original = trimesh.triangles.points_to_barycentric
    try:
        # An unresolved numerical primitive is neither proven contact nor
        # proven separation. Preserve a typed failure rather than either claim.
        trimesh.triangles.points_to_barycentric = lambda triangles, points, method: np.full((len(triangles), 3), np.nan)
        try:
            solver._coplanar_edge_contact(np.array([[0, 1.5, 0], [2, 1.5, 0]]), triangle, solver._RayIntersector(triangle))
        except solver.SolverError as error:
            assert error.code == "numerical-failure"
        else:
            raise AssertionError("Non-finite shell arithmetic must fail explicitly")
    finally:
        trimesh.triangles.points_to_barycentric = original
