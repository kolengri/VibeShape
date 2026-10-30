"""Independent direct-reference and failure fixtures for low-memory elasticity."""

import itertools
import json

import numpy as np
import scipy.sparse as sparse
import scipy.sparse.linalg as sparse_linalg
import trimesh


def _iterative_request(extents=(8, 4, 3), poisson=0.35):
    source = trimesh.creation.box(extents=extents)
    source.apply_translation(np.asarray(extents) / 2)
    length, width, height = extents
    return {
        "schemaVersion": 1,
        "mesh": {"vertices": source.vertices.ravel().tolist(), "indices": source.faces.ravel().tolist()},
        "material": {"youngModulusMpa": 1000, "poissonRatio": poisson,
                     "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2,
        "maxDisplacementMm": 1,
        "cellSizeMm": 1,
        "supports": [{"min": [0, 0, 0], "max": [0, width, height]}],
        "loadCases": [
            {"name": "offset-bending-torsion", "region": {"min": [length, width - 1, 0],
             "max": [length, width, 1]}, "forceN": [0.001, 0.004, -0.003]},
            {"name": "opposite-corner", "region": {"min": [length, 0, height - 1],
             "max": [length, 1, height]}, "forceN": [-0.002, -0.001, 0.004]},
        ],
        "preserveRegions": [],
        "maxIterations": 0,
    }


def _iterative_problem(solver, poisson):
    request = _iterative_request(poisson=poisson)
    cells = np.array([cell for cell in itertools.product(range(8), range(4), range(3))
                      if cell not in ((3, 3, 2), (4, 3, 2))])
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    source = solver._surface(mesh, None)
    fixed, loads, _ = solver._conditions(request, mesh, nodes, cells, 1, source, None)
    return cells, fixed, loads


def verify_iterative_direct_reference(solver, poisson, varied):
    cells, fixed, loads = _iterative_problem(solver, poisson)
    modulus = None
    if varied:
        # A spatially interleaved field avoids reducing the contrast to a 1D bar.
        # This covers the entire SIMP ersatz range, including its 1e-6 floor.
        modulus = np.geomspace(1e-6, 1, len(cells))[(np.arange(len(cells)) * 37) % len(cells)]
        assert modulus.min() == 1e-6 and modulus.max() == 1
    namespace = solver._evaluate.__globals__
    original_cg, original_solve = namespace["cg"], namespace["_solve_elasticity"]
    iterative_displacements, reference_displacements = [], []

    def observed_cg(matrix, force, **options):
        displacement, info = original_cg(matrix, force, **options)
        assert info == 0
        assert np.linalg.norm(matrix @ displacement - force) <= 1e-8 * np.linalg.norm(force)
        iterative_displacements.append(displacement.copy())
        return displacement, info

    def direct_reference(matrix, force, **_options):
        displacement = sparse_linalg.spsolve(matrix, force)
        assert np.isfinite(displacement).all()
        assert np.linalg.norm(matrix @ displacement - force) <= 1e-8 * np.linalg.norm(force)
        reference_displacements.append(displacement.copy())
        return displacement

    def evaluate(field):
        return solver._evaluate(cells, np.zeros(3), 1, (1000, poisson, 100), fixed, loads,
                                1000, None, relative_modulus=modulus, field=field, sum_cases=True)

    try:
        namespace["cg"] = observed_cg
        actual = [evaluate(field) for field in ("strain-energy", "von-mises")]
        namespace["_solve_elasticity"] = direct_reference
        expected = [evaluate(field) for field in ("strain-energy", "von-mises")]
    finally:
        namespace["cg"], namespace["_solve_elasticity"] = original_cg, original_solve

    assert len(iterative_displacements) == len(reference_displacements) == 2 * len(loads)
    # A six-digit field agreement allows conditioning effects across 1e6 modulus
    # contrast. The separate uniform axial fixtures retain their tighter tolerances.
    tolerance = 1e-6
    for displacement, reference in zip(iterative_displacements, reference_displacements):
        assert np.linalg.norm(displacement - reference) <= tolerance * np.linalg.norm(reference)
        assert np.all(np.linalg.norm(reference.reshape(-1, 3), axis=0) > 1e-8 * np.linalg.norm(reference))
    for (metrics, field, _), (reference, reference_field, _) in zip(actual, expected):
        assert np.allclose(field, reference_field, rtol=tolerance, atol=1e-10 * reference_field.max())
        assert np.all(field > 0)
        for case, reference_case in zip(metrics["cases"], reference["cases"]):
            assert case["name"] == reference_case["name"]
            for key in ("maxDisplacementMm", "maxVonMisesMpa", "complianceNmm", "safetyFactor"):
                assert np.isclose(case[key], reference_case[key], rtol=tolerance, atol=0)
    # The reported element energy is integral(sigma:epsilon), without a 1/2.
    assert np.isclose(actual[0][1].sum(), sum(case["complianceNmm"] for case in actual[0][0]["cases"]),
                      rtol=1e-8, atol=0)


def verify_iterative_failure(solver, failure):
    namespace = solver._evaluate.__globals__
    original_cg = namespace["cg"]
    calls = []

    def failed_cg(matrix, force, **options):
        displacement, info = original_cg(matrix, force, **options)
        assert info == 0
        calls.append(True)
        if failure == "iteration-limit":
            return displacement, 7
        if failure == "breakdown":
            return displacement, -1
        if failure == "nonfinite":
            displacement[0] = np.nan
            return displacement, 0
        assert failure == "false-convergence"
        # A finite positive-energy answer would pass stress/energy checks. Only
        # equilibrium can reject this misleading successful convergence status.
        return displacement * 0.9, 0

    try:
        namespace["cg"] = failed_cg
        response = json.loads(solver.solve_json(json.dumps(_iterative_request())))
    finally:
        namespace["cg"] = original_cg
    assert calls == [True]
    assert response["ok"] is False and response["error"]["code"] == "numerical-failure"
    assert "result" not in response
    if failure == "false-convergence":
        message = response["error"]["message"]
        for field in ("phase=baseline", "case=offset-bending-torsion", "dofs=", "nnz=", "status=0",
                      "iterations=", "rhs=", "residual=", "limit=", "backward=", "corrections=[]"):
            assert field in message
        assert len(message) <= 512


def verify_iterative_residual_correction_failure(solver, failure):
    namespace = solver._solve_elasticity.__globals__
    original_cg = namespace["cg"]
    matrix = sparse.diags([1e12, 1.], format="csr")
    force = np.ones(2)
    calls = []

    def injected_cg(_matrix, rhs, **options):
        calls.append(options)
        if len(calls) == 1:
            return np.array([1e-12 + 1e-19, 1.]), 0
        assert options["rtol"] == 0 and options["atol"] == 1e-10 * np.linalg.norm(force)
        if failure == "iteration-limit":
            return np.zeros(2), 7
        if failure == "nonfinite":
            return np.full(2, np.nan), 0
        assert failure == "stagnation"
        return np.zeros(2), 0

    try:
        namespace["cg"] = injected_cg
        try:
            solver._solve_elasticity(matrix, force)
        except solver.SolverError as error:
            assert error.code == "numerical-failure"
            assert "residual" in str(error) and "limit=" in str(error)
            assert len(calls) == (4 if failure == "stagnation" else 2)
        else:
            raise AssertionError("A failed residual correction must not publish displacements")
    finally:
        namespace["cg"] = original_cg


def verify_iterative_true_residual(solver):
    cells = np.array(list(itertools.product(range(96), range(2), range(1))), dtype=np.int64)
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    fixed = {tuple(node) for node in nodes if node[0] == 0}
    facets = [frozenset(tuple(node) for node in nodes[mesh.facets[:, facet]])
              for facet in mesh.boundary_facets() if np.all(nodes[mesh.facets[:, facet], 0] == 96)]
    loads = [{"name": "slender-bending", "facets": facets, "force": np.array([0., 0., -.001])}]
    namespace = solver._evaluate.__globals__
    original_solve = namespace["_solve_elasticity"]
    direct_names = ("spsolve", "splu", "factorized")
    original_direct = {name: getattr(sparse_linalg, name) for name in direct_names}
    reports = []
    answers = []

    def observed(matrix, force, **options):
        answer = original_solve(matrix, force, **options)
        residual = np.linalg.norm(matrix @ answer - force)
        assert residual <= 1e-8 * np.linalg.norm(force)
        assert len(options["solve_trace"]["corrections"]) <= 3
        reports.append(float(residual / np.linalg.norm(force)))
        answers.append(answer.copy())
        return answer

    def forbidden(*_args, **_options):
        raise AssertionError("Residual correction must not allocate a direct sparse factorization")

    def direct(matrix, force, **_options):
        answer = original_direct["spsolve"](matrix, force)
        assert np.linalg.norm(answer - answers[0]) <= 1e-6 * np.linalg.norm(answer)
        return answer

    def evaluate():
        return solver._evaluate(cells, np.zeros(3), 1, (1000, .35, 100), fixed, loads, 1000, None)

    try:
        namespace["_solve_elasticity"] = observed
        for name in direct_names:
            setattr(sparse_linalg, name, forbidden)
        actual, energy, _ = evaluate()
        namespace["_solve_elasticity"] = direct
        expected, reference_energy, _ = evaluate()
    finally:
        namespace["_solve_elasticity"] = original_solve
        for name, original in original_direct.items():
            setattr(sparse_linalg, name, original)
    for metric in ("maxDisplacementMm", "maxVonMisesMpa", "safetyFactor"):
        assert np.isclose(actual[metric], expected[metric], rtol=1e-6, atol=0)
    assert np.allclose(energy, reference_energy, rtol=1e-6, atol=0)
    assert np.isfinite(energy).all() and np.all(energy > 0)
    return {"relativeResidual": reports[0], "volumeMm3": actual["volumeMm3"]}


def verify_iterative_invalid_stiffness(solver):
    cells, fixed, loads = _iterative_problem(solver, 0.35)
    for value in (np.nan, 0, -1):
        try:
            solver._evaluate(cells, np.zeros(3), 1, (1000, 0.35, 100), fixed, loads, 1000, None,
                             relative_modulus=np.full(len(cells), value))
        except solver.SolverError as error:
            assert error.code == "numerical-failure"
        else:
            raise AssertionError("A non-finite or nonpositive stiffness must fail explicitly")


def verify_iterative_compact_analytical_solve(solver):
    request = _iterative_request((32, 8, 6), poisson=0)
    request["loadCases"] = [{"name": "axial", "region": {"min": [32, 0, 0], "max": [32, 8, 6]},
                             "forceN": [10, 0, 0]}]
    namespace = solver._evaluate.__globals__
    original_cg = namespace["cg"]
    direct_names = ("spsolve", "splu", "factorized")
    original_direct = {name: getattr(sparse_linalg, name) for name in direct_names}
    residuals = []

    def observed_cg(matrix, force, **options):
        displacement, info = original_cg(matrix, force, **options)
        assert info == 0
        residuals.append(float(np.linalg.norm(matrix @ displacement - force) / np.linalg.norm(force)))
        return displacement, info

    def forbidden_factorization(*_args, **_options):
        raise AssertionError("The full-solid solve must not allocate a direct sparse factorization")

    try:
        namespace["cg"] = observed_cg
        for name in direct_names:
            setattr(sparse_linalg, name, forbidden_factorization)
        result = solver.solve(request)
    finally:
        namespace["cg"] = original_cg
        for name, original in original_direct.items():
            setattr(sparse_linalg, name, original)
    assert len(residuals) == result["evaluations"] and max(residuals) <= 1e-8
    assert result["initialCellCount"] == result["finalCellCount"] == 1536
    baseline = result["baseline"]
    assert np.isclose(baseline["maxVonMisesMpa"], 10 / 48, rtol=1e-7, atol=0)
    assert np.isclose(baseline["maxDisplacementMm"], 10 * 32 / (1000 * 48), rtol=1e-7, atol=0)
    assert np.isclose(baseline["cases"][0]["complianceNmm"], 10 ** 2 * 32 / (1000 * 48), rtol=1e-7, atol=0)
    assert result["optimized"] == baseline
    return result


def verify_iterative_large_analytical_solve(solver):
    # Generate a dense 3D system comparable to the reported fine-grid failure,
    # without retaining a private model or repeating source voxelization.
    cells = np.array(list(itertools.product(range(35), range(35), range(36))), dtype=np.int64)
    mesh, nodes = solver._hex_mesh(cells, np.zeros(3), 1)
    fixed = {tuple(node) for node in nodes if node[0] == 0}
    loaded = [frozenset(tuple(node) for node in nodes[mesh.facets[:, facet]])
              for facet in mesh.boundary_facets() if np.all(nodes[mesh.facets[:, facet], 0] == 35)]
    assert len(loaded) == 1260
    loads = [{"name": "axial", "facets": loaded, "force": np.array([10., 0., 0.])}]
    del mesh, nodes
    metrics, energy, surface = solver._evaluate(cells, np.zeros(3), 1, (1000, 0., 100),
                                              fixed, loads, 1000, None)
    assert np.isclose(metrics["volumeMm3"], 44100, rtol=1e-12)
    assert np.isclose(surface.volume, 44100, rtol=1e-12)
    assert np.isclose(metrics["maxVonMisesMpa"], 10 / 1260, rtol=1e-7, atol=0)
    assert np.isclose(metrics["maxDisplacementMm"], 10 * 35 / (1000 * 1260), rtol=1e-7, atol=0)
    compliance = metrics["cases"][0]["complianceNmm"]
    assert np.isclose(compliance, 100 * 35 / (1000 * 1260), rtol=1e-7, atol=0)
    assert np.isclose(energy.sum(), compliance, rtol=1e-8, atol=0)
    return metrics
