"""Original-interface evidence for independent fixed-body verification."""

import copy
import itertools
import json

import numpy as np


def _reference_boundary_keys():
    occupied = set(itertools.product(range(8), range(4), range(4)))
    fixed = {point for point in itertools.product(range(9), range(5), range(5))
             if point[0] <= 2 and any(point[axis] in (0, extent)
                                      for axis, extent in enumerate((8, 4, 4)))}
    primary, secondary = [], []
    for cell in occupied:
        for axis, side in itertools.product(range(3), (0, 1)):
            neighbor = list(cell)
            neighbor[axis] += 2 * side - 1
            if tuple(neighbor) in occupied:
                continue
            face = frozenset(tuple(cell[i] + (side if i == axis else bit[i]) for i in range(3))
                             for bit in itertools.product((0, 1), repeat=3))
            if all(point[0] >= 6 and point[1] <= 2 for point in face):
                primary.append(face)
            if all(point[0] == 8 and point[1] >= 3 for point in face):
                secondary.append(face)
    loads = [{"name": "couple", "force": np.array([0, 0, -0.5]), "facets": primary,
              "additionalLoads": [{"force": np.array([0, 0, 0.5]), "facets": secondary}]}]
    return occupied, fixed, loads


def _reference_body_request(solver, shifted=False):
    occupied, fixed, loads = _reference_boundary_keys()
    cells = occupied - {(1, 1, 1), (6, 1, 1)}
    if shifted:
        cells.add((-1, 1, 1))

    def surface(value):
        mesh, _ = solver._hex_mesh(np.array(sorted(value)), np.zeros(3), 1)
        body = solver._surface(mesh)
        return {"vertices": body.vertices.ravel().tolist(), "indices": body.faces.ravel().tolist()}

    request = {
        "schemaVersion": 1, "mesh": surface(cells), "boundaryReferenceMesh": surface(occupied),
        "voxelGridOriginMm": [0, 0, 0], "includeVoxelGrid": True,
        "material": {"youngModulusMpa": 1000, "poissonRatio": 0.35,
                     "yieldStrengthMpa": 100, "densityKgM3": 1000},
        "safetyFactor": 2, "maxDisplacementMm": 1, "cellSizeMm": 1,
        "supports": [{"min": [0, 0, 0], "max": [2, 4, 4]}],
        "loadCases": [{"name": "couple", "region": {"min": [6, 0, 0], "max": [8, 2, 4]},
                       "forceN": [0, 0, -0.5], "additionalLoads": [
                           {"region": {"min": [8, 3, 0], "max": [8, 4, 4]}, "forceN": [0, 0, 0.5]}]}],
        "preserveRegions": [], "maxIterations": 0,
    }
    return request, np.array(sorted(cells)), fixed, loads


def verify_fixed_boundary_reference(solver, shifted):
    request, cells, expected_fixed, expected_loads = _reference_body_request(solver, shifted)
    assert len(expected_fixed) == 57
    assert len(expected_loads[0]["facets"]) == 24
    assert len(expected_loads[0]["additionalLoads"][0]["facets"]) == 4
    namespace = solver.solve.__globals__
    original = namespace["_evaluate"]
    captures = []

    def observe(candidate, origin, spacing, material, fixed, loads, *args, **options):
        captures.append((origin.copy(), fixed, loads))
        return original(candidate, origin, spacing, material, fixed, loads, *args, **options)

    try:
        namespace["_evaluate"] = observe
        result = solver.solve(request)
    finally:
        namespace["_evaluate"] = original
    assert len(captures) == result["evaluations"] == 2
    expected_origin = np.array([-1, 0, 0] if shifted else [0, 0, 0])
    assert result["voxelGrid"]["originMm"] == expected_origin.tolist()
    for origin, fixed, loads in captures:
        assert np.array_equal(origin, expected_origin)
        mapped_fixed = {tuple(np.array(point) + origin) for point in fixed}
        assert mapped_fixed == expected_fixed
        for actual, expected in zip([loads[0]] + loads[0]["additionalLoads"],
                                    [expected_loads[0]] + expected_loads[0]["additionalLoads"]):
            facets = {frozenset(tuple(np.array(point) + origin) for point in face)
                      for face in actual["facets"]}
            assert facets == set(expected["facets"])
            assert np.array_equal(actual["force"], expected["force"])
    # This direct solve uses independently enumerated original interfaces in
    # world lattice coordinates, not the new reference-resolution helper.
    expected, _, _ = original(cells, np.zeros(3), 1, (1000, 0.35, 100),
                              expected_fixed, expected_loads, 1000, None)
    for key in ("maxVonMisesMpa", "maxDisplacementMm", "safetyFactor"):
        assert np.isclose(result["optimized"][key], expected[key], rtol=1e-9, atol=1e-12)
    assert np.isclose(result["optimized"]["cases"][0]["complianceNmm"],
                      expected["cases"][0]["complianceNmm"], rtol=1e-9, atol=1e-12)
    ordinary = copy.deepcopy(request)
    del ordinary["boundaryReferenceMesh"]
    source, origin, _ = solver._source(ordinary, 1)
    ordinary_cells = solver._voxelize(source, None)
    mesh, nodes = solver._hex_mesh(ordinary_cells, origin, 1)
    fixed, loads, _ = solver._conditions(ordinary, mesh, nodes, ordinary_cells, 1, source, None)
    assert len(fixed) == 65, "The ordinary selector must demonstrate eight additional cavity clamps."
    assert len(loads[0]["facets"]) == 30, "The cavity must acquire six unintended load facets."
    ordinary_result = solver.solve(ordinary)
    assert not np.isclose(ordinary_result["optimized"]["cases"][0]["complianceNmm"],
                          expected["cases"][0]["complianceNmm"], rtol=1e-4, atol=0)


def verify_missing_reference_interface(solver):
    request, cells, _, _ = _reference_body_request(solver)
    cells = cells[~np.all(cells == [7, 1, 1], axis=1)]
    mesh, _ = solver._hex_mesh(cells, np.zeros(3), 1)
    body = solver._surface(mesh)
    request["mesh"] = {"vertices": body.vertices.ravel().tolist(), "indices": body.faces.ravel().tolist()}
    response = json.loads(solver.solve_json(json.dumps(request)))
    assert not response["ok"] and response["error"]["code"] == "boundary-condition-lost", response


def verify_invalid_boundary_reference(solver):
    valid, _, _, _ = _reference_body_request(solver)
    patches = [
        {"boundaryReferenceMesh": None}, {"boundaryReferenceMesh": {}},
        {"boundaryReferenceMesh": {**valid["boundaryReferenceMesh"], "extra": True}},
        {"boundaryReferenceMesh": {**valid["boundaryReferenceMesh"], "indices": [999] * 12}},
        {"boundaryReferenceMesh": {**valid["boundaryReferenceMesh"], "vertices": [float("nan")] * 12}},
        {"maxIterations": 1}, {"objective": {"kind": "minimize-mass"}},
        {"algorithm": {"kind": "simp", "volumeFraction": 0.8, "filterRadiusMm": 1.5, "penalty": 3}},
        {"relativePerformance": {"minStiffnessFraction": 0.9, "minStrengthFraction": 0.9}},
        {"preserveRegions": [{"min": [0, 0, 0], "max": [8, 4, 4]}]},
    ]
    for patch in patches:
        response = json.loads(solver.solve_json(json.dumps({**valid, **patch})))
        assert not response["ok"] and response["error"]["code"] == "invalid-input", response
    unaligned = copy.deepcopy(valid)
    del unaligned["voxelGridOriginMm"]
    unaligned["mesh"]["vertices"] = [value + (0.25 if index % 3 == 0 else 0)
                                     for index, value in enumerate(unaligned["mesh"]["vertices"])]
    response = json.loads(solver.solve_json(json.dumps(unaligned)))
    assert not response["ok"] and response["error"]["code"] == "invalid-input", response
