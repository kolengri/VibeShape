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


def verify_triangle_query_bounds(solver):
    triangles = np.array([[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
                          [[2, 2, 2], [3, 2, 2], [2, 3, 2]]], dtype=float)
    for offset in (0, -100, 99990):
        index = solver._TriangleIndex(triangles + offset)
        for bounds, expected in (([1, 1, 0, 2, 2, 2], [0, 1]),
                                 ([0, 0, 0, 0, 0, 0], [0]),
                                 ([1.01, 1.01, 0.01, 1.99, 1.99, 1.99], [])):
            assert index.intersection(np.asarray(bounds) + offset).tolist() == expected
    rng = np.random.default_rng(47)
    triangles = rng.uniform(-20, 20, (600, 3, 3))
    triangles = triangles[rng.permutation(len(triangles))]
    index = solver._TriangleIndex(triangles)
    for _ in range(512):
        corners = rng.uniform(-30, 30, (2, 3))
        lo, hi = corners.min(axis=0), corners.max(axis=0)
        expected = np.flatnonzero(np.all((index.lo <= hi) & (index.hi >= lo), axis=1))
        assert np.array_equal(index.intersection(np.r_[lo, hi]), expected)
    tolerance = solver.CELL_TOLERANCE
    for axis in range(3):
        for x, expected in ((tolerance, False), (tolerance + 1e-5, True),
                            (1 - tolerance, False), (1 - tolerance - 1e-5, True)):
            vertices = np.roll([[x, 0.2, 0.2], [x, 0.8, 0.2], [x, 0.2, 0.8]], axis, axis=1)
            mesh = trimesh.Trimesh(vertices, [[0, 1, 2]], process=False)
            assert solver._boundary_crosses_cell(mesh, solver._TriangleIndex(mesh.triangles), np.zeros(3)) == expected


def verify_voxel_filter_equivalence(solver):
    class ReferenceIndex(solver._TriangleIndex):
        def intersection(self, bounds):
            return np.flatnonzero(np.all((self.lo <= bounds[3:]) & (self.hi >= bounds[:3]), axis=1))

    def reference_boundary(mesh, index, cell):
        lo = cell.astype(float) + solver.CELL_TOLERANCE
        hi = cell.astype(float) + 1 - solver.CELL_TOLERANCE
        candidate = np.flatnonzero(np.all((index.lo < hi) & (index.hi > lo), axis=1))
        if not len(candidate):
            return False
        vertices = mesh.triangles[candidate].reshape(-1, 3)
        faces = np.arange(len(vertices)).reshape(-1, 3)
        for axis in range(3):
            for sign, boundary in ((1, lo[axis]), (-1, hi[axis])):
                normal, point = np.zeros(3), np.zeros(3)
                normal[axis], point[axis] = sign, boundary
                vertices, faces, _ = trimesh.intersections.slice_faces_plane(vertices, faces, normal, point)
                if not len(faces):
                    return False
        return bool(np.any(trimesh.triangles.area(vertices[faces]) > 1e-14))

    box = trimesh.creation.box(extents=[6, 4, 3])
    rotated = trimesh.creation.box(extents=[8, 6, 4])
    rotated.apply_transform(trimesh.transformations.rotation_matrix(0.2, [0, 0, 1]))
    cavity = trimesh.creation.box(extents=[2, 2, 2])
    cavity.invert()
    nested = trimesh.util.concatenate([trimesh.creation.box(extents=[8, 8, 6]), cavity])
    fixtures = [box, rotated, trimesh.creation.annulus(r_min=1.2, r_max=4.8, height=4, sections=24),
                nested, trimesh.creation.icosphere(subdivisions=1, radius=4)]
    namespace = solver._voxelize.__globals__
    original_index, original_boundary = namespace['_TriangleIndex'], namespace['_boundary_crosses_cell']
    counts = []
    try:
        for mesh in fixtures:
            request = resource_request()
            request['mesh'] = {'vertices': mesh.vertices.ravel().tolist(), 'indices': mesh.faces.ravel().tolist()}
            source, _, _ = solver._source(request, 1)
            namespace['_TriangleIndex'], namespace['_boundary_crosses_cell'] = ReferenceIndex, reference_boundary
            expected = solver._voxelize(source, None)
            namespace['_TriangleIndex'], namespace['_boundary_crosses_cell'] = original_index, original_boundary
            actual = solver._voxelize(source, None)
            assert np.array_equal(actual, expected)
            counts.append(len(actual))
        request = resource_request((8, 4, 3))
        request['loadCases'].append({**request['loadCases'][0], 'name': 'bending', 'forceN': [0, 1, 0]})
        namespace['_TriangleIndex'], namespace['_boundary_crosses_cell'] = ReferenceIndex, reference_boundary
        expected = solver.solve(request)
        namespace['_TriangleIndex'], namespace['_boundary_crosses_cell'] = original_index, original_boundary
        actual = solver.solve(request)
        assert actual == expected
    finally:
        namespace['_TriangleIndex'], namespace['_boundary_crosses_cell'] = original_index, original_boundary
    assert counts[0] == 72 and all(count > 0 for count in counts)
    return counts
