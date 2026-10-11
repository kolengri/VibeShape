"""Bounded, conservative voxel lightweighting with full-solid linear elasticity.

All lengths are millimetres, forces newtons, and stresses MPa.  The returned
unsmoothed mesh is exactly the surface of the cells used in the final FEM solve.
This heuristic supplies discretized numerical evidence, not a strength rating.
"""

import json
import itertools
import math
import time
import warnings

import numpy as np
import scipy.sparse as sparse
from scipy.sparse.csgraph import connected_components
from scipy.sparse.linalg import MatrixRankWarning
import trimesh
from trimesh.ray.ray_triangle import ray_triangle_id
from trimesh.ray.ray_util import contains_points
from skfem import Basis, ElementHex1, ElementVector, FacetBasis, LinearForm, MeshHex, asm, condense
from skfem import solve as fem_solve
from skfem.helpers import dot, sym_grad
from skfem.models.elasticity import lame_parameters, linear_elasticity, linear_stress


MAX_CELLS = 3000
MAX_NODES = 5000
MAX_GRID_CELLS = 12000
MAX_TRIANGLES = 20000
MAX_VERTICES = 10000
MAX_SECONDS = 180
CELL_TOLERANCE = 1e-6
HEX_CORNERS = np.asarray(MeshHex().p.T, dtype=np.int64)
NEIGHBORS = np.asarray([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])


class SolverError(ValueError):
    """A rejected input or numerical result which must never become an output."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _require(condition, code, message):
    if not condition:
        raise SolverError(code, message)


def _number(value, name, minimum, maximum):
    _require(isinstance(value, (int, float)) and not isinstance(value, bool), "invalid-input", f"{name} must be a number.")
    _require(math.isfinite(value) and minimum <= value <= maximum, "invalid-input", f"{name} is outside its finite supported range.")
    return float(value)


def _vector(value, name, bound=100000):
    _require(isinstance(value, list) and len(value) == 3, "invalid-input", f"{name} requires three coordinates.")
    return np.array([_number(x, name, -bound, bound) for x in value])


def _objective(request):
    if "objective" not in request:
        return None
    objective = request["objective"]
    _require(isinstance(objective, dict), "invalid-input", "objective must be a supported objective object.")
    if objective.get("kind") == "minimize-mass":
        _require(set(objective) == {"kind"}, "invalid-input", "The minimum-mass objective requires only kind.")
        return {"kind": "minimize-mass"}
    _require(objective.get("kind") == "maximize-stiffness" and set(objective) == {"kind", "retainedMassFraction"},
             "invalid-input", "The stiffness objective requires kind and retainedMassFraction.")
    return {"kind": "maximize-stiffness", "retainedMassFraction":
            _number(objective["retainedMassFraction"], "retainedMassFraction", 0.1, 1)}


def _region(value, triangle_count):
    _require(isinstance(value, dict), "invalid-input", "A region must be a box or captured surface selection.")
    if value.get("kind") == "surface":
        _require(set(value) == {"kind", "triangleIndices", "depthMm"}, "invalid-input", "Surface regions require only kind, triangleIndices, and depthMm.")
        indices = value["triangleIndices"]
        _require(isinstance(indices, list) and 0 < len(indices) <= MAX_TRIANGLES,
                 "invalid-input", "Surface selections require 1 to 20000 captured source triangles.")
        _require(all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < triangle_count for i in indices),
                 "invalid-input", "Surface triangle indices must reference the captured source mesh.")
        _require(len(set(indices)) == len(indices), "invalid-input", "Surface triangle indices must be unique.")
        depth = _number(value["depthMm"], "depthMm", 0, 100000)
        _require(depth > 0, "invalid-input", "Surface depthMm must be positive.")
        return {"triangles": frozenset(indices), "depth": depth}
    _require(set(value) == {"min", "max"}, "invalid-input", "Box regions require only min and max coordinates.")
    lo = _vector(value.get("min"), "region.min")
    hi = _vector(value.get("max"), "region.max")
    _require(np.all(lo <= hi), "invalid-input", "Region minimum must not exceed maximum.")
    return lo, hi


def _within(points, region, tolerance):
    lo, hi = region
    return np.all((points >= lo - tolerance) & (points <= hi + tolerance), axis=-1)


def _obstacle_regions(request):
    regions = request.get("obstacleRegions", [])
    _require(isinstance(regions, list) and len(regions) <= 16,
             "invalid-input", "At most 16 obstacle box regions are supported.")
    boxes = []
    for region in regions:
        _require(isinstance(region, dict) and set(region) == {"min", "max"},
                 "invalid-input", "Obstacle regions require only box min and max coordinates.")
        box = _region(region, 0)
        _require(np.all(box[0] < box[1]), "invalid-input", "Obstacle boxes must have positive extent on every axis.")
        boxes.append(box)
    return boxes


def _obstacle_mask(cells, origin, cell_size, boxes):
    lo = origin + cells * cell_size
    hi = lo + cell_size
    mask = np.zeros(len(cells), dtype=bool)
    # Leave room for the permitted float32 STL displacement, plus grid arithmetic.
    # Every captured triangle stays inside its cell expanded by this axis margin.
    tolerance = cell_size * (1e-6 + 1e-9)
    for rlo, rhi in boxes:
        mask |= np.all((lo <= rhi + tolerance) & (hi >= rlo - tolerance), axis=1)
    return mask


def _fdm_settings(request):
    if "fdm" not in request:
        return None
    value = request["fdm"]
    keys = {"buildDirection", "supportMode", "minFeatureSizeMm", "layerHeightMm", "maxOverhangAngleDeg"}
    _require(isinstance(value, dict) and set(value) == keys, "invalid-input", "fdm requires exactly the five supported settings.")
    _require(isinstance(value["buildDirection"], str) and value["buildDirection"] in {"+x", "-x", "+y", "-y", "+z", "-z"}, "invalid-input", "Unsupported FDM build direction.")
    _require(isinstance(value["supportMode"], str) and value["supportMode"] in {"forbidden", "allowed"}, "invalid-input", "Unsupported FDM support mode.")
    return {"buildDirection": value["buildDirection"], "supportMode": value["supportMode"],
            "minFeatureSizeMm": _number(value["minFeatureSizeMm"], "minFeatureSizeMm", 0.01, 100000),
            "layerHeightMm": _number(value["layerHeightMm"], "layerHeightMm", 0.001, 100000),
            "maxOverhangAngleDeg": _number(value["maxOverhangAngleDeg"], "maxOverhangAngleDeg", 0, 89)}


def _fdm_context(settings, cells, origin, cell_size):
    if settings is None:
        return None
    axis = "xyz".index(settings["buildDirection"][1])
    sign = 1 if settings["buildDirection"][0] == "+" else -1
    bed = int((sign * cells[:, axis] - (sign < 0)).min())
    return {"settings": settings, "axis": axis, "sign": sign, "bed": bed,
            "xy": [i for i in range(3) if i != axis],
            "k": math.ceil(settings["minFeatureSizeMm"] / cell_size),
            "plate": float(sign * (sign * origin[axis] + bed * cell_size)),
            "reach": settings["layerHeightMm"] * math.tan(math.radians(settings["maxOverhangAngleDeg"]))}


def _fdm_feature_bound(cells, origin, cell_size, context):
    k = context["k"]
    lo = cells.min(axis=0)
    shape = cells.max(axis=0) - lo + 1
    # Reject impossible cubes before any k-dependent allocation. Dense work is
    # bounded by the original voxel grid, not by requested physical dimensions.
    if k ** 3 > len(cells) or np.any(shape < k):
        return 0.0
    _require(math.prod(int(x) for x in shape) <= MAX_GRID_CELLS, "resource-limit", "FDM morphology exceeds the bounded voxel grid.")
    occupied = np.zeros(tuple(shape), dtype=np.int32)
    occupied[tuple((cells - lo).T)] = 1
    prefix = np.pad(occupied, ((1, 0),) * 3).cumsum(0).cumsum(1).cumsum(2)
    sums = np.zeros(tuple(shape - k + 1), dtype=np.int32)
    for bits in itertools.product((0, 1), repeat=3):
        slices = tuple(slice(k, None) if bit else slice(None, -k) for bit in bits)
        sums += (-1) ** (3 - sum(bits)) * prefix[slices]
    anchors = np.argwhere(sums == k ** 3)
    if not len(anchors):
        return 0.0
    world_lo = origin + (anchors + lo) * cell_size
    world_hi = origin + (anchors + lo + k) * cell_size
    rounded_width = world_hi.astype(np.float32).astype(float) - world_lo.astype(np.float32).astype(float)
    bounds = np.minimum(world_hi - world_lo, rounded_width).min(axis=1)
    eligible = bounds >= context["settings"]["minFeatureSizeMm"]
    anchors = anchors[eligible]
    if not len(anchors):
        return 0.0
    # Union of filled cubes via a difference array. This is a coverage proof for
    # every occupied voxel, not a neighbor count, local density, or volume proxy.
    difference = np.zeros(tuple(shape + 1), dtype=np.int32)
    for bits in itertools.product((0, 1), repeat=3):
        corners = anchors + np.asarray(bits) * k
        np.add.at(difference, tuple(corners.T), (-1) ** sum(bits))
    coverage = difference.cumsum(0).cumsum(1).cumsum(2)[tuple((cells - lo).T)]
    return float(bounds[eligible].min()) if np.all(coverage > 0) else 0.0


def _fdm_uncovered_face(face, lower_rectangles, expansion):
    lo, hi = face[:2], face[2:]
    area = float(np.prod(hi - lo))
    if not len(lower_rectangles):
        return area
    rlo = np.maximum(lower_rectangles[:, :2] - expansion, lo)
    rhi = np.minimum(lower_rectangles[:, 2:] + expansion, hi)
    if np.any(np.all((rlo <= lo) & (rhi >= hi), axis=1)):
        return 0.0
    present = np.all(rhi > rlo, axis=1)
    rlo, rhi = rlo[present], rhi[present]
    if not len(rlo):
        return area
    xs = np.unique(np.r_[lo[0], hi[0], rlo[:, 0], rhi[:, 0]])
    covered = 0.0
    for x0, x1 in zip(xs[:-1], xs[1:]):
        active = (rlo[:, 0] <= x0) & (rhi[:, 0] >= x1)
        intervals = sorted(zip(rlo[active, 1], rhi[active, 1]))
        end, length = lo[1], 0.0
        for y0, y1 in intervals:
            length += max(0.0, y1 - max(end, y0))
            end = max(end, y1)
        covered += (x1 - x0) * length
    return max(0.0, area - covered)


def _fdm_metrics(cells, origin, cell_size, context, deadline):
    _require(time.monotonic() < deadline, "resource-limit", "FDM verification exceeded its time budget.")
    world_lo, world_hi = origin + cells * cell_size, origin + (cells + 1) * cell_size
    for coordinates in (world_lo, world_hi):
        _require(np.all(np.abs(coordinates.astype(np.float32).astype(float) - coordinates) <= cell_size * 1e-6),
                 "serialization-precision", "FDM geometry exceeds the structural float32 displacement allowance.")
    axis = context["axis"]
    raw_thickness = world_hi[:, axis] - world_lo[:, axis]
    rounded_thickness = (world_hi[:, axis].astype(np.float32).astype(float) -
                         world_lo[:, axis].astype(np.float32).astype(float))
    # A previous print layer must not skip an actual raw or captured voxel slice.
    _require(np.all(np.minimum(raw_thickness, rounded_thickness) >= context["settings"]["layerHeightMm"]),
             "invalid-input", "FDM layer height exceeds a raw or captured float32 build-axis slice. Decrease layer height or use coarser cells.")
    bound = _fdm_feature_bound(cells, origin, cell_size, context)
    levels = context["sign"] * cells[:, context["axis"]] - (context["sign"] < 0)
    xy = context["xy"]
    raw = np.c_[world_lo[:, xy], world_hi[:, xy]]
    rounded = raw.astype(np.float32).astype(float)
    layers = {int(level): np.flatnonzero(levels == level) for level in np.unique(levels)}
    occupied = {tuple(cell) for cell in cells}
    step = np.zeros(3, dtype=int)
    step[context["axis"]] = context["sign"]
    unsupported = 0.0
    # An L-infinity square of half-width reach/sqrt(2) is contained in the
    # Euclidean reach disk. Its union can overestimate support need, never claim
    # coverage outside the specified one-print-layer horizontal reach.
    expansion = context["reach"] / math.sqrt(2)
    for index, cell in enumerate(cells):
        if levels[index] == context["bed"] or tuple(cell - step) in occupied:
            continue
        _require(time.monotonic() < deadline, "resource-limit", "FDM footprint verification exceeded its time budget.")
        lower = layers.get(int(levels[index]) - 1, np.array([], dtype=int))
        unsupported += max(_fdm_uncovered_face(raw[index], raw[lower], expansion),
                           _fdm_uncovered_face(rounded[index], rounded[lower], expansion))
    return {"unsupportedAreaMm2": float(unsupported), "requiresSupports": bool(unsupported > 0),
            "minFeatureSizeBoundMm": bound,
            "buildHeightMm": float((levels.max() + 1 - context["bed"]) * cell_size)}


def _fdm_feasible(metrics, context):
    return (metrics["minFeatureSizeBoundMm"] >= context["settings"]["minFeatureSizeMm"] and
            (context["settings"]["supportMode"] == "allowed" or not metrics["requiresSupports"]))


def _require_fdm(metrics, context, code):
    _require(metrics["minFeatureSizeBoundMm"] >= context["settings"]["minFeatureSizeMm"], code,
             "FDM minimum-feature coverage fails: every occupied voxel must belong to a filled requested-size cube in both raw and float32 geometry.")
    _require(context["settings"]["supportMode"] == "allowed" or not metrics["requiresSupports"], code,
             "FDM support-free geometry has uncovered downward footprints at the configured one-layer reach.")


class _TriangleIndex:
    """Small local AABB index implementing trimesh rays and proximity queries.

    The triangle intersection and point-in-solid algorithms remain in trimesh;
    this bounded broad phase avoids the native rtree dependency in Pyodide.
    """

    def __init__(self, triangles):
        self.lo = triangles.min(axis=1)
        self.hi = triangles.max(axis=1)
        self.bounds = np.r_[self.lo.min(axis=0), self.hi.max(axis=0)]

    def intersection(self, bounds):
        return np.flatnonzero(np.all((self.lo <= bounds[3:]) & (self.hi >= bounds[:3]), axis=1))


class _RayIntersector:
    def __init__(self, mesh):
        self.mesh = mesh
        self.tree = _TriangleIndex(mesh.triangles)

    def intersects_location(self, origins, directions, multiple_hits=True):
        triangle_ids, ray_ids, locations = ray_triangle_id(
            self.mesh.triangles, origins, directions,
            triangles_normal=self.mesh.face_normals, tree=self.tree,
            multiple_hits=multiple_hits,
        )
        if len(locations):
            unique = trimesh.grouping.unique_rows(np.column_stack((locations, ray_ids)))[0]
            return locations[unique], ray_ids[unique], triangle_ids[unique]
        return locations, ray_ids, triangle_ids


def _connected(cells):
    if not len(cells):
        return False
    lookup = {tuple(c): i for i, c in enumerate(cells)}
    rows, cols = [], []
    for i, c in enumerate(cells):
        for step in NEIGHBORS[::2]:
            j = lookup.get(tuple(c + step))
            if j is not None:
                rows.extend((i, j))
                cols.extend((j, i))
    graph = sparse.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(cells), len(cells)))
    return connected_components(graph, directed=False, return_labels=False) == 1


def _check_surface(mesh, label):
    _require(mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume,
             "invalid-mesh", f"{label} must be a closed, oriented, positive-volume manifold.")
    _require(np.all(mesh.area_faces > 1e-14), "invalid-mesh", f"{label} contains degenerate triangles.")
    edges = np.sort(mesh.edges, axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    _require(np.all(counts == 2), "invalid-mesh", f"{label} has nonmanifold edges.")
    adjacency = mesh.face_adjacency
    graph = sparse.coo_matrix((np.ones(len(adjacency) * 2),
                              (np.r_[adjacency[:, 0], adjacency[:, 1]], np.r_[adjacency[:, 1], adjacency[:, 0]])),
                             shape=(len(mesh.faces), len(mesh.faces)))
    _require(connected_components(graph, directed=False, return_labels=False) == 1,
             "disconnected-mesh", f"{label} must have one connected surface without separate cavity shells.")
    # An edge-manifold mesh can still have a pinched vertex.  Its incident face
    # fan must be one cycle; otherwise merging its shared node invents stiffness.
    incident = [[] for _ in mesh.vertices]
    for face_id, face in enumerate(mesh.faces):
        for vertex in face:
            incident[vertex].append(face_id)
    around = [[] for _ in mesh.vertices]
    for pair, edge in zip(mesh.face_adjacency, mesh.face_adjacency_edges):
        for vertex in edge:
            around[vertex].append(tuple(pair))
    for faces, pairs in zip(incident, around):
        if not faces:
            continue
        linked = {faces[0]}
        pending = list(pairs)
        while pending:
            remaining = []
            for a, b in pending:
                if a in linked or b in linked:
                    linked.update((a, b))
                else:
                    remaining.append((a, b))
            if len(remaining) == len(pending):
                break
            pending = remaining
        _require(len(linked) == len(faces), "invalid-mesh", f"{label} has a nonmanifold vertex.")


def _source(request, cell_size):
    value = request.get("mesh")
    _require(isinstance(value, dict), "invalid-input", "mesh is required.")
    raw_vertices, raw_indices = value.get("vertices"), value.get("indices")
    _require(isinstance(raw_vertices, list) and 12 <= len(raw_vertices) <= MAX_VERTICES * 3 and len(raw_vertices) % 3 == 0,
             "resource-limit", "Source vertex count is outside the supported budget.")
    _require(isinstance(raw_indices, list) and 12 <= len(raw_indices) <= MAX_TRIANGLES * 3 and len(raw_indices) % 3 == 0,
             "resource-limit", "Source triangle count is outside the supported budget.")
    vertices = np.array([_number(x, "mesh coordinate", -100000, 100000) for x in raw_vertices]).reshape(-1, 3)
    _require(all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < len(vertices) for x in raw_indices),
             "invalid-input", "Mesh indices must reference source vertices.")
    origin = vertices.min(axis=0)
    # Cell-scale coordinates keep trimesh's geometric tolerance independent of
    # document scale.  Welding changes adjacency only within 1e-10 cell.
    normalized = trimesh.Trimesh((vertices - origin) / cell_size, np.array(raw_indices).reshape(-1, 3), process=False)
    # Vertex welding preserves face order: captured triangle selections keep
    # addressing the original immutable input rather than transient topology.
    normalized.merge_vertices(digits_vertex=10)
    _check_surface(normalized, "Source mesh")
    return normalized, origin, float(normalized.volume * cell_size ** 3)


def _boundary_crosses_cell(mesh, index, cell):
    lo = cell.astype(float) + CELL_TOLERANCE
    hi = cell.astype(float) + 1 - CELL_TOLERANCE
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


def _voxelize(mesh, deadline):
    shape = np.floor(mesh.bounds[1] + CELL_TOLERANCE).astype(int)
    _require(np.all(shape >= 1), "resolution-empty", "Cell size is too large to retain a complete source cell.")
    _require(math.prod(int(x) for x in shape) <= MAX_GRID_CELLS,
             "resource-limit", "Candidate grid exceeds 12000 cells; increase cell size.")
    grid = np.indices(tuple(shape)).reshape(3, -1).T
    rays = _RayIntersector(mesh)
    inside = np.zeros(len(grid), dtype=bool)
    # Two deterministic directions agree for a retained centre.  Disagreement
    # conservatively excludes that cell rather than perturbing the mesh.
    directions = ([0.4395064455, 0.617598629942, 0.652231566745], [0.811107, 0.324443, 0.486664])
    for start in range(0, len(grid), 32):
        _require(time.monotonic() < deadline, "resource-limit", "Voxelization exceeded its time budget.")
        points = grid[start:start + 32] + 0.5
        masks = [contains_points(rays, points, check_direction=d) for d in directions]
        inside[start:start + len(points)] = masks[0] & masks[1]
    cells = []
    for cell in grid[inside]:
        _require(time.monotonic() < deadline, "resource-limit", "Voxelization exceeded its time budget.")
        if not _boundary_crosses_cell(mesh, rays.tree, cell):
            cells.append(cell)
    _require(0 < len(cells) <= MAX_CELLS, "resource-limit", "Retained solid must contain 1 to 3000 complete cells; adjust cell size.")
    cells = np.asarray(cells)
    _require(_connected(cells), "disconnected-mesh", "Conservative voxelization separates the body; decrease cell size.")
    return cells


def _hex_mesh(cells, origin, cell_size):
    corners = (cells[:, None, :] + HEX_CORNERS).reshape(-1, 3)
    nodes, inverse = np.unique(corners, axis=0, return_inverse=True)
    _require(len(nodes) <= MAX_NODES, "resource-limit", "The FEM mesh exceeds 5000 nodes; increase cell size.")
    mesh = MeshHex((origin + nodes * cell_size).T, inverse.reshape(-1, 8).T)
    return mesh, nodes


def _surface(mesh):
    quads = mesh.facets[:, mesh.boundary_facets()].T
    triangles = np.vstack((quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]))
    output = trimesh.Trimesh(mesh.p.T, triangles, process=False)
    # Hex facet orientation is an incidence convention, not exterior winding.
    trimesh.repair.fix_normals(output, multibody=False)
    output.remove_unreferenced_vertices()
    _check_surface(output, "Analyzed cell surface")
    return output


def _nearest_surface(source, points, deadline, normals=None):
    """Resolve all nearest ties using trimesh's triangle-distance implementation.

    A tie across aligned source faces remains ambiguous instead of choosing a
    triangle ordinal.  Queries are bounded to one source-triangle array at a
    time; the existing local index replaces trimesh's native rtree broad phase.
    """
    source._cache["triangles_tree"] = _TriangleIndex(source.triangles)
    matches = []
    for start in range(0, len(points), 32):
        _require(time.monotonic() < deadline, "resource-limit", "Surface mapping exceeded its time budget.")
        batch = points[start:start + 32]
        candidates = trimesh.proximity.nearby_faces(source, batch)
        for offset, (point, candidate) in enumerate(zip(batch, candidates)):
            candidate = np.asarray(candidate, dtype=int)
            closest = trimesh.triangles.closest_point(source.triangles[candidate], np.tile(point, (len(candidate), 1)))
            distance = np.linalg.norm(closest - point, axis=1)
            nearest = float(distance.min())
            tied = candidate[distance <= nearest + 1e-9]
            if normals is not None:
                aligned = source.face_normals[tied] @ normals[start + offset] > 1e-9
                tied = tied[aligned]
            matches.append((frozenset(tied.tolist()), nearest))
    return matches


def _surface_mask(matches, region, distance_limit):
    return np.array([bool(tied) and tied <= region["triangles"] and distance <= distance_limit + 1e-9
                     for tied, distance in matches], dtype=bool)


def _conditions(request, mesh, nodes, cells, cell_size, source, deadline):
    tolerance = cell_size * 1e-9
    origin = mesh.p[:, 0] - nodes[0] * cell_size
    boundary_nodes = np.unique(mesh.facets[:, mesh.boundary_facets()])
    supports = request.get("supports")
    _require(isinstance(supports, list) and 0 < len(supports) <= 8, "no-support-nodes", "One to eight support regions are required.")
    supports = [_region(region, len(source.faces)) for region in supports]
    cases = request.get("loadCases")
    _require(isinstance(cases, list) and 0 < len(cases) <= 8, "invalid-input", "One to eight load cases are required.")
    case_regions = []
    for case in cases:
        _require(isinstance(case, dict), "invalid-input", "Each load case must be an object.")
        case_regions.append(_region(case.get("region"), len(source.faces)))
    regions = request.get("preserveRegions", [])
    _require(isinstance(regions, list) and len(regions) <= 16, "invalid-input", "At most 16 preserve regions are supported.")
    preserve = [_region(region, len(source.faces)) for region in regions]
    surfaces = [region for region in supports + case_regions + preserve if isinstance(region, dict)]
    facets = mesh.boundary_facets()
    facet_nodes = mesh.facets[:, facets].T
    facet_matches = []
    cell_matches = []
    if surfaces:
        centers = mesh.p.T[facet_nodes].mean(axis=1)
        owners = mesh.f2t[0, facets]
        cell_centers = mesh.p.T[mesh.t[:, owners].T].mean(axis=1)
        normals = centers - cell_centers
        normals /= np.linalg.norm(normals, axis=1)[:, None]
        facet_matches = _nearest_surface(source, (centers - origin) / cell_size, deadline, normals)
        cell_matches = _nearest_surface(source, cells + 0.5, deadline)
    # Every exterior cell has an excluded neighboring grid cell.  A source
    # boundary farther than this diagonal is not that exterior's target.
    surface_band = math.sqrt(3)
    fixed = set()
    for region in supports:
        if isinstance(region, dict):
            selected = np.unique(facet_nodes[_surface_mask(facet_matches, region, surface_band)])
        else:
            selected = boundary_nodes[_within(mesh.p.T[boundary_nodes], region, tolerance)]
        _require(len(selected), "no-support-nodes", "A support region selects no actual exterior FEM nodes; adjust its surface selection, bounds, or resolution.")
        fixed.update(selected.tolist())
    fixed = np.array(sorted(fixed), dtype=int)
    positions = mesh.p.T[fixed]
    centered = (positions - positions.mean(axis=0)) / cell_size
    rigid = np.zeros((len(fixed) * 3, 6))
    for i, (x, y, z) in enumerate(centered):
        rigid[3 * i:3 * i + 3, :3] = np.eye(3)
        rigid[3 * i:3 * i + 3, 3:] = [[0, z, -y], [-z, 0, x], [y, -x, 0]]
    _require(np.linalg.matrix_rank(rigid) == 6, "underconstrained", "Supports do not constrain all six rigid-body modes.")
    fixed_keys = {tuple(node) for node in nodes[fixed]}
    loads = []
    protected_keys = set(fixed_keys)
    names = set()
    for case, region in zip(cases, case_regions):
        name = case.get("name")
        _require(isinstance(name, str) and 0 < len(name.strip()) <= 80 and name not in names,
                 "invalid-input", "Load cases require unique nonempty names up to 80 characters.")
        names.add(name)
        force = _vector(case.get("forceN"), "forceN", 1e6)
        _require(np.linalg.norm(force) > 0, "invalid-input", "Each load case requires a nonzero resultant force.")
        if isinstance(region, dict):
            mask = _surface_mask(facet_matches, region, surface_band)
        else:
            mask = _within(mesh.p.T[facet_nodes], region, tolerance).all(axis=1)
        _require(np.any(mask), "no-load-facets", "A load region selects no complete exterior FEM facet; adjust its surface selection, bounds, or resolution.")
        selected_nodes = facet_nodes[mask]
        _require(not set(np.unique(selected_nodes)).intersection(fixed.tolist()), "load-support-overlap", "Load facets must not touch clamped support nodes.")
        keys = [frozenset(tuple(p) for p in nodes[quad]) for quad in selected_nodes]
        protected_keys.update(p for key in keys for p in key)
        loads.append({"name": name, "force": force, "facets": keys})
    protected = set()
    surface_protected = np.zeros(len(cells), dtype=bool)
    for region in surfaces:
        selected_facets = _surface_mask(facet_matches, region, surface_band)
        if any(region is preserved for preserved in preserve):
            _require(np.any(selected_facets), "no-preserve-cells", "A preserved surface selects no actual exterior FEM facet; adjust its surface selection or resolution.")
        surface_protected[owners[selected_facets]] = True
        # The nearest full-source surface defines membership, including curved
        # and trimmed faces.  A half-cell diagonal conservatively rounds depth
        # to whole cells; depth does not cross another surface's nearest region.
        surface_protected |= _surface_mask(cell_matches, region, region["depth"] / cell_size + math.sqrt(3) / 2)
    boxes = [region for region in preserve if not isinstance(region, dict)]
    for index, cell in enumerate(cells):
        corners = cell + HEX_CORNERS
        if any(tuple(p) in protected_keys for p in corners):
            protected.add(tuple(cell))
        lo, hi = origin + cell * cell_size, origin + (cell + 1) * cell_size
        if surface_protected[index] or any(np.all((lo <= rhi + tolerance) & (hi >= rlo - tolerance)) for rlo, rhi in boxes):
            protected.add(tuple(cell))
    return fixed_keys, loads, protected


def _evaluate(cells, origin, cell_size, material, fixed_keys, loads, density, deadline):
    _require(time.monotonic() < deadline, "resource-limit", "Optimization exceeded its time budget.")
    _require(_connected(cells), "disconnected-mesh", "Removal disconnects the analyzed solid.")
    mesh, nodes = _hex_mesh(cells, origin, cell_size)
    surface = _surface(mesh)
    _require(abs(surface.volume - len(cells) * cell_size ** 3) <= max(1e-8, len(cells) * cell_size ** 3 * 1e-8),
             "invalid-mesh", "Returned surface volume does not match the analyzed cells.")
    basis = Basis(mesh, ElementVector(ElementHex1()), intorder=3)
    corner_basis = Basis(mesh, basis.elem, quadrature=(HEX_CORNERS.T.astype(float), np.ones(8)))
    lam, mu = lame_parameters(material[0], material[1])
    stiffness = asm(linear_elasticity(lam, mu), basis).tocsr()
    node_lookup = {tuple(p): i for i, p in enumerate(nodes)}
    _require(fixed_keys <= node_lookup.keys(), "boundary-condition-lost", "A candidate loses a support node.")
    fixed_nodes = np.array([node_lookup[p] for p in sorted(fixed_keys)])
    fixed_dofs = basis.nodal_dofs[:, fixed_nodes].ravel()
    facets = mesh.boundary_facets()
    facet_lookup = {frozenset(tuple(p) for p in nodes[mesh.facets[:, f]]): f for f in facets}
    energy = np.zeros(len(cells))
    metrics = []
    for load in loads:
        _require(all(key in facet_lookup for key in load["facets"]), "boundary-condition-lost", "A candidate changes a loaded exterior facet.")
        load_facets = np.array([facet_lookup[key] for key in load["facets"]])
        facet_basis = FacetBasis(mesh, basis.elem, facets=load_facets, intorder=3)
        area = float(facet_basis.dx.sum())
        traction = load["force"] / area

        @LinearForm
        def distributed_load(v, _):
            return dot(traction[:, None, None], v)

        force = asm(distributed_load, facet_basis)
        _require(np.allclose(force[basis.nodal_dofs].sum(axis=1), load["force"], rtol=1e-9, atol=1e-9),
                 "numerical-failure", "Integrated load does not match its specified resultant.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", MatrixRankWarning)
                displacement = fem_solve(*condense(stiffness, force, D=fixed_dofs))
        except (MatrixRankWarning, RuntimeError, ValueError) as error:
            raise SolverError("numerical-failure", "The full-solid elasticity solve failed or is singular.") from error
        _require(np.isfinite(displacement).all(), "numerical-failure", "Elasticity returned a non-finite displacement.")
        free = np.setdiff1d(np.arange(basis.N), fixed_dofs)
        residual = (stiffness @ displacement - force)[free]
        _require(np.linalg.norm(residual) <= 1e-8 * max(np.linalg.norm(force[free]), 1e-12),
                 "numerical-failure", "The elasticity equilibrium residual exceeds its tolerance.")
        strain = sym_grad(basis.interpolate(displacement))
        corner_strain = sym_grad(corner_basis.interpolate(displacement))
        _require(max(float(np.sqrt(np.sum(field ** 2, axis=(0, 1))).max())
                     for field in (strain, corner_strain)) <= 0.05,
                 "small-strain-limit", "The solution exceeds the supported small-strain regime.")
        stress = linear_stress(lam, mu)(strain)
        corner_stress = linear_stress(lam, mu)(corner_strain)
        maxima = []
        # On axis-aligned Q1 cells, every stress component is multi-affine.
        # The convex von Mises norm therefore attains its element maximum at a
        # corner.  Keep discontinuous element-corner values without averaging.
        for field in (stress, corner_stress):
            mean = np.trace(field, axis1=0, axis2=1) / 3
            deviator = field - np.eye(3)[:, :, None, None] * mean[None, None, :, :]
            maxima.append(float(np.sqrt(1.5 * np.sum(deviator ** 2, axis=(0, 1))).max()))
        max_stress = max(maxima)
        max_displacement = float(np.linalg.norm(displacement[basis.nodal_dofs], axis=0).max())
        compliance = float(force @ displacement)
        _require(math.isfinite(max_stress) and math.isfinite(compliance) and max_stress > 0 and compliance > 0,
                 "numerical-failure", "Elasticity produced invalid stress or energy.")
        energy = np.maximum(energy, np.sum(np.sum(stress * strain, axis=(0, 1)) * basis.dx, axis=1))
        metrics.append({"name": load["name"], "maxVonMisesMpa": max_stress,
                        "maxDisplacementMm": max_displacement, "safetyFactor": material[2] / max_stress,
                        "complianceNmm": compliance})
    return {"volumeMm3": float(len(cells) * cell_size ** 3),
            "massKg": float(len(cells) * cell_size ** 3 * density * 1e-9),
            "maxVonMisesMpa": max(case["maxVonMisesMpa"] for case in metrics),
            "maxDisplacementMm": max(case["maxDisplacementMm"] for case in metrics),
            "safetyFactor": min(case["safetyFactor"] for case in metrics), "cases": metrics}, energy, surface


def solve(request):
    """Optimize one source mesh, returning only a repeatedly verified feasible mesh."""
    _require(isinstance(request, dict) and request.get("schemaVersion") == 1,
             "invalid-input", "Only structural request schemaVersion 1 is supported.")
    started = time.monotonic()
    deadline = started + MAX_SECONDS
    objective = _objective(request)
    fdm_settings = _fdm_settings(request)
    cell_size = _number(request.get("cellSizeMm"), "cellSizeMm", 1e-4, 100000)
    _require(fdm_settings is None or fdm_settings["layerHeightMm"] <= cell_size,
             "invalid-input", "FDM layer height must not exceed the voxel cell size for one-slice support coverage.")
    max_displacement = _number(request.get("maxDisplacementMm"), "maxDisplacementMm", 1e-9, 100000)
    safety_factor = _number(request.get("safetyFactor"), "safetyFactor", 1, 100)
    max_iterations = request.get("maxIterations")
    _require(isinstance(max_iterations, int) and not isinstance(max_iterations, bool) and 0 <= max_iterations <= 40,
             "invalid-input", "maxIterations must be an integer from 0 to 40.")
    material = request.get("material")
    _require(isinstance(material, dict), "invalid-input", "material is required.")
    parameters = (_number(material.get("youngModulusMpa"), "youngModulusMpa", 1e-3, 1e7),
                  _number(material.get("poissonRatio"), "poissonRatio", -0.95, 0.45),
                  _number(material.get("yieldStrengthMpa"), "yieldStrengthMpa", 1e-6, 1e6))
    density = _number(material.get("densityKgM3"), "densityKgM3", 1e-3, 1e6)
    obstacles = _obstacle_regions(request)
    source, origin, source_volume = _source(request, cell_size)
    cells = _voxelize(source, deadline)
    initial_mesh, nodes = _hex_mesh(cells, origin, cell_size)
    # Resolve authored boundaries against the original captured-source baseline;
    # exclusion must never remap a load or support onto a newly exposed cavity.
    fixed_keys, loads, protected = _conditions(request, initial_mesh, nodes, cells, cell_size, source, deadline)
    excluded = _obstacle_mask(cells, origin, cell_size, obstacles)
    _require(not any(tuple(cell) in protected for cell in cells[excluded]),
             "invalid-input", "Obstacle boxes intersect protected, support, or load cells on the original baseline.")
    cells = cells[~excluded]
    _require(_connected(cells), "infeasible-baseline", "Obstacle exclusion empties or disconnects the analyzed baseline.")
    initial_count = len(cells)
    target_count = (math.ceil(initial_count * objective["retainedMassFraction"])
                    if objective and objective["kind"] == "maximize-stiffness" else None)
    fdm_context = _fdm_context(fdm_settings, cells, origin, cell_size)
    baseline_fdm = None
    if fdm_context is not None:
        baseline_fdm = _fdm_metrics(cells, origin, cell_size, fdm_context, deadline)
        _require_fdm(baseline_fdm, fdm_context, "infeasible-baseline")

    def feasible(metrics):
        return metrics["safetyFactor"] >= safety_factor and metrics["maxDisplacementMm"] <= max_displacement

    baseline, energy, _ = _evaluate(cells, origin, cell_size, parameters, fixed_keys, loads, density, deadline)
    _require(feasible(baseline), "infeasible-baseline", "The conservative full-solid baseline violates stress, safety-factor, or displacement limits.")
    evaluations, iterations = 1, 0
    termination = "iteration-limit"
    for iteration in range(max_iterations):
        if target_count is not None and len(cells) == target_count:
            termination = "target-mass-reached"
            break
        iterations = iteration + 1
        occupied = {tuple(cell) for cell in cells}
        eligible = np.array([i for i, cell in enumerate(cells) if tuple(cell) not in protected
                             and any(tuple(cell + step) not in occupied for step in NEIGHBORS)], dtype=int)
        if not len(eligible):
            termination = "no-removable-cells"
            break
        ranked = eligible[np.argsort(energy[eligible], kind="stable")]
        remove_count = min(len(ranked), max(1, math.ceil(len(cells) * 0.04)))
        if target_count is not None:
            remove_count = min(remove_count, len(cells) - target_count)
        accepted = False
        while remove_count:
            mask = np.ones(len(cells), dtype=bool)
            mask[ranked[:remove_count]] = False
            candidate = cells[mask]
            if fdm_context is not None:
                candidate_fdm = _fdm_metrics(candidate, origin, cell_size, fdm_context, deadline)
                if not _fdm_feasible(candidate_fdm, fdm_context):
                    remove_count //= 2
                    continue
            try:
                evaluations += 1
                metrics, candidate_energy, _ = _evaluate(candidate, origin, cell_size, parameters, fixed_keys, loads, density, deadline)
                if feasible(metrics):
                    cells, energy = candidate, candidate_energy
                    accepted = True
                    break
            except SolverError as error:
                if error.code not in {"disconnected-mesh", "invalid-mesh", "numerical-failure", "small-strain-limit"}:
                    raise
            remove_count //= 2
        if not accepted:
            termination = "constraints-or-topology"
            break
    if target_count is not None and len(cells) == target_count:
        termination = "target-mass-reached"
    # Never attach a previous candidate's metrics to a newly emitted surface.
    optimized, _, output = _evaluate(cells, origin, cell_size, parameters, fixed_keys, loads, density, deadline)
    evaluations += 1
    _require(feasible(optimized), "final-verification-failed", "Repeated final full-solid analysis violates a constraint.")
    _require(optimized["volumeMm3"] <= baseline["volumeMm3"] + 1e-8,
             "final-verification-failed", "The final volume exceeds the baseline.")
    _require(not np.any(_obstacle_mask(cells, origin, cell_size, obstacles)),
             "final-verification-failed", "The final analyzed cells intersect a keep-out box.")
    optimized_fdm = None
    if fdm_context is not None:
        optimized_fdm = _fdm_metrics(cells, origin, cell_size, fdm_context, deadline)
        _require_fdm(optimized_fdm, fdm_context, "final-verification-failed")
    result = {"schemaVersion": 1, "status": "improved" if len(cells) < initial_count else "no-improvement",
            "mesh": {"vertices": output.vertices.ravel().tolist(), "indices": output.faces.ravel().tolist()},
            "baseline": baseline, "optimized": optimized, "sourceVolumeMm3": source_volume,
            "sourceVolumeLossFraction": max(0.0, 1 - baseline["volumeMm3"] / source_volume),
            "cellSizeMm": cell_size, "initialCellCount": initial_count, "finalCellCount": len(cells),
            "iterations": iterations, "evaluations": evaluations, "termination": termination,
            "warnings": ["Conservative voxel approximation; boundary details smaller than the cell size may be lost.",
                         ("Heuristic energy-ranked feasible removal at a retained baseline-mass target, without a global stiffness-optimum guarantee."
                          if target_count is not None else "Heuristic feasible material removal, without a global-minimum guarantee."),
                         "Linear isotropic small-strain FEM; unaveraged element-corner and quadrature stress is resolution dependent and is not a physical strength certification.",
                         "Sharp voxel and clamped-boundary corners can create continuum stress singularities; finite FEM peaks do not establish converged continuum maxima.",
                         "Loads are uniform tractions on selected baseline facets; all load, support, and preservation cells remain fixed."] +
                        (["Keep-outs exclude entire cells on closed-box contact. Baseline metrics and retained-mass targets use the obstacle-excluded baseline; sourceVolumeLossFraction includes obstacle exclusion and conservative voxelization, before optimization."]
                         if obstacles else []) +
                        (["Surface selections use nearest captured-source triangles and aligned voxel exterior facets within one cell diagonal; ambiguous edges are excluded. Preservation depth is rounded by half a cell diagonal and stops at another nearest source surface."]
                         if any(region.get("kind") == "surface" for region in request["supports"] + [case["region"] for case in request["loadCases"]] + request.get("preserveRegions", [])) else [])}
    if fdm_context is not None:
        result["fdm"] = {"settings": fdm_settings, "approximation": "conservative-voxel",
                         "minimumFeatureCubeCells": fdm_context["k"], "horizontalReachMm": fdm_context["reach"],
                         "buildPlateCoordinateMm": fdm_context["plate"],
                         "baseline": baseline_fdm, "optimized": optimized_fdm}
        result["warnings"].extend([
            "FDM feature coverage requires filled axis-aligned k-cubed voxel blocks with k=ceil(minFeatureSizeMm/cellSizeMm). The bound covers raw and float32 coordinates; no sub-target feature is accepted by rounding tolerance.",
            "FDM support need uses exposed downward voxel footprints, a fixed baseline build plate, and inscribed-square coverage within layerHeightMm*tan(angle from vertical) per print layer. Layer height cannot exceed voxel cell size. Unsupported area is a conservative upper estimate, not support volume or cost. No bridging, anisotropy, slicer equivalence, or printer certification is implied."])
    if objective is not None:
        result["objective"] = objective
        if target_count is not None:
            _require(len(cells) >= target_count, "final-verification-failed", "The final mass is below the retained-mass target.")
            objective.update(targetMassKg=baseline["massKg"] * objective["retainedMassFraction"],
                             targetCellCount=target_count,
                             achievedRetainedMassFraction=optimized["massKg"] / baseline["massKg"],
                             targetStatus="reached" if len(cells) == target_count else "not-reached")
            if objective["targetStatus"] == "not-reached":
                result["warnings"].append("Retained-mass target not reached: constraints, protected cells, topology, or the iteration limit prevented further feasible removal.")
    return result


def solve_json(request_json):
    """Pyodide entrypoint with a JSON-only success or typed failure envelope."""
    try:
        result = solve(json.loads(request_json))
        return json.dumps({"ok": True, "result": result}, allow_nan=False, separators=(",", ":"))
    except SolverError as error:
        return json.dumps({"ok": False, "error": {"code": error.code, "message": str(error)}})
    except (ValueError, TypeError, KeyError, OverflowError, np.linalg.LinAlgError):
        return json.dumps({"ok": False, "error": {"code": "invalid-input", "message": "The structural request or numerical result is invalid."}})
