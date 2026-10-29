"""Conservative voxel lightweighting with full-solid linear elasticity.

All lengths are millimetres, forces newtons, and stresses MPa.  The returned
unsmoothed mesh is exactly the surface of the cells used in the final FEM solve.
This heuristic supplies discretized numerical evidence, not a strength rating.
"""

import json
import itertools
import math

import numpy as np
import scipy.sparse as sparse
from scipy.sparse.csgraph import connected_components
from scipy.sparse.linalg import LinearOperator, cg
from scipy.spatial import cKDTree
from scipy.ndimage import distance_transform_cdt
import trimesh
from trimesh.ray.ray_triangle import ray_triangle_id
from trimesh.ray.ray_util import contains_points
from skfem import Basis, ElementHex1, ElementVector, FacetBasis, LinearForm, MeshHex, asm, condense
from skfem import solve as fem_solve
from skfem.helpers import dot, sym_grad
from skfem.models.elasticity import lame_parameters, linear_elasticity, linear_stress


# Deadline arguments remain compatible with existing callers; worker disposal owns cancellation.
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


def _relative_performance(request):
    if "relativePerformance" not in request:
        return None
    value = request["relativePerformance"]
    keys = {"minStiffnessFraction", "minStrengthFraction"}
    _require(isinstance(value, dict) and set(value) == keys,
             "invalid-input", "relativePerformance requires exactly minimum stiffness and strength fractions.")
    result = {key: _number(value[key], key, 0, 1) for key in keys}
    _require(all(fraction > 0 for fraction in result.values()),
             "invalid-input", "Relative performance fractions must be positive.")
    return result


def _relative_feasible(metrics, baseline, settings):
    if settings is None:
        return True
    if len(metrics["cases"]) != len(baseline["cases"]):
        return False
    for case, reference in zip(metrics["cases"], baseline["cases"]):
        if case["name"] != reference["name"]:
            return False
        for metric, fraction in (("complianceNmm", "minStiffnessFraction"),
                                 ("maxVonMisesMpa", "minStrengthFraction")):
            # No absolute tolerance floor: a small but loaded case still owns
            # its complete relative budget. Zero-energy cases are invalid.
            if not (math.isfinite(reference[metric]) and reference[metric] > 0 and
                    math.isfinite(case[metric]) and case[metric] > 0 and
                    case[metric] <= reference[metric] / settings[fraction]):
                return False
    return True


def _algorithm(request, cell_size, objective):
    if "algorithm" not in request:
        return None
    value = request["algorithm"]
    _require(isinstance(value, dict), "invalid-input", "algorithm must be a supported object.")
    if value.get("kind") == "simp":
        _require(set(value) == {"kind", "volumeFraction", "filterRadiusMm", "penalty"}, "invalid-input", "SIMP requires exactly kind, volumeFraction, filterRadiusMm, penalty.")
        result = {"kind": "simp", "volumeFraction": _number(value["volumeFraction"], "volumeFraction", 0.1, 1),
                  "filterRadiusMm": _number(value["filterRadiusMm"], "filterRadiusMm", cell_size, 100000),
                  "penalty": _number(value["penalty"], "penalty", 1, 5)}
        _require(objective is None or objective["kind"] != "maximize-stiffness" or objective["retainedMassFraction"] == result["volumeFraction"],
                 "invalid-input", "SIMP volume fraction must match the stiffness objective retained fraction.")
        return result
    keys = {"kind", "lattice", "cellPeriodMm", "minWallThicknessMm", "maxWallThicknessMm", "skinThicknessMm", "field", "gamma"}
    _require(value.get("kind") == "adaptive-lattice" and set(value) == keys, "invalid-input", "Adaptive lattice requires exactly the supported TPMS settings.")
    _require(isinstance(value["lattice"], str) and value["lattice"] in {"gyroid", "schwarz-p", "schwarz-d"}, "invalid-input", "Unsupported TPMS lattice.")
    _require(isinstance(value["field"], str) and value["field"] in {"strain-energy", "von-mises"}, "invalid-input", "Unsupported TPMS grading field.")
    result = {"kind": "adaptive-lattice", "lattice": value["lattice"], "field": value["field"],
              "cellPeriodMm": _number(value["cellPeriodMm"], "cellPeriodMm", 8 * cell_size, 100000),
              "minWallThicknessMm": _number(value["minWallThicknessMm"], "minWallThicknessMm", 2 * cell_size, 100000),
              "maxWallThicknessMm": _number(value["maxWallThicknessMm"], "maxWallThicknessMm", 0.01, 100000),
              "skinThicknessMm": _number(value["skinThicknessMm"], "skinThicknessMm", 0, 100000),
              "gamma": _number(value["gamma"], "gamma", 0.1, 8)}
    _require(result["minWallThicknessMm"] <= result["maxWallThicknessMm"] <= result["cellPeriodMm"] / 2,
             "invalid-input", "Maximum TPMS wall thickness must lie between minimum thickness and half a period.")
    _require(result["skinThicknessMm"] == 0 or result["skinThicknessMm"] >= cell_size,
             "invalid-input", "A nonzero TPMS skin requires at least one cell.")
    return result


def _region(value, triangle_count):
    _require(isinstance(value, dict), "invalid-input", "A region must be a box or captured surface selection.")
    if value.get("kind") == "surface":
        _require(set(value) == {"kind", "triangleIndices", "depthMm"}, "invalid-input", "Surface regions require only kind, triangleIndices, and depthMm.")
        indices = value["triangleIndices"]
        _require(isinstance(indices, list) and len(indices) > 0,
                 "invalid-input", "Surface selections require captured source triangles.")
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
    _require(isinstance(regions, list), "invalid-input", "Obstacle regions must be a list.")
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
    context = {"settings": settings, "axis": axis, "sign": sign, "bed": bed,
               "xy": [i for i in range(3) if i != axis],
               "k": math.ceil(settings["minFeatureSizeMm"] / cell_size),
               "plate": float(sign * (sign * origin[axis] + bed * cell_size)),
               "reach": settings["layerHeightMm"] * math.tan(math.radians(settings["maxOverhangAngleDeg"]))}
    # Eligible overlapping cubes can cover a short-span anchor. Retain that
    # complete union proof before trying a genuinely larger resolved cube.
    if _fdm_feature_bound(cells, origin, cell_size, context) < settings["minFeatureSizeMm"]:
        context["k"] += 1
    return context


def _fdm_feature_bound(cells, origin, cell_size, context):
    k = context["k"]
    lo = cells.min(axis=0)
    shape = cells.max(axis=0) - lo + 1
    # Reject impossible cubes before any k-dependent allocation. Dense work is
    # bounded by the original voxel grid, not by requested physical dimensions.
    if k ** 3 > len(cells) or np.any(shape < k):
        return 0.0
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
    world_lo, world_hi = origin + cells * cell_size, origin + (cells + 1) * cell_size
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
        # Axis vectors avoid an N-by-3 temporary and its costly row reduction in WASM.
        lo, hi = self.lo, self.hi
        return np.flatnonzero((lo[:, 0] <= bounds[3]) & (hi[:, 0] >= bounds[0])
                              & (lo[:, 1] <= bounds[4]) & (hi[:, 1] >= bounds[1])
                              & (lo[:, 2] <= bounds[5]) & (hi[:, 2] >= bounds[2]))


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


def _coplanar_edge_contact(edge, other, rays):
    tolerance = 1e-9
    possible = rays.tree.intersection(np.r_[edge.min(axis=0) - tolerance, edge.max(axis=0) + tolerance])
    if not len(possible):
        return False
    triangles = other.triangles[possible]
    normals = other.face_normals[possible]
    distances = np.einsum("nvi,ni->nv", edge[None, :, :] - triangles[:, :1, :], normals)
    triangles = triangles[np.all(np.abs(distances) <= tolerance, axis=1)]
    if not len(triangles):
        return False
    # Trimesh supplies barycentrics. Clip the segment parameter against the
    # three triangle half-planes, including contact with edges and vertices.
    start = trimesh.triangles.points_to_barycentric(triangles, np.repeat(edge[:1], len(triangles), axis=0), method="cross")
    end = trimesh.triangles.points_to_barycentric(triangles, np.repeat(edge[1:], len(triangles), axis=0), method="cross")
    delta = end - start
    _require(np.all(np.isfinite(start)) and np.all(np.isfinite(end)) and np.all(np.isfinite(delta)),
             "numerical-failure", "Coplanar shell contact could not be resolved numerically.")
    lower, upper = np.zeros(len(triangles)), np.ones(len(triangles))
    valid = np.ones(len(triangles), dtype=bool)
    for axis in range(3):
        slope = delta[:, axis]
        flat = np.abs(slope) <= 1e-15
        valid &= ~flat | (start[:, axis] >= -1e-10)
        crossing = np.divide(-1e-10 - start[:, axis], slope, out=np.zeros(len(triangles)), where=~flat)
        lower = np.where(slope > 1e-15, np.maximum(lower, crossing), lower)
        upper = np.where(slope < -1e-15, np.minimum(upper, crossing), upper)
    return bool(np.any(valid & (lower <= upper)))


def _require_shells_disjoint(first, other, rays, label, deadline):
    edges = first.vertices[first.edges_unique]
    directions = edges[:, 1] - edges[:, 0]
    lengths = np.linalg.norm(directions, axis=1)
    directions /= lengths[:, None]
    for start in range(0, len(edges), 32):
        locations, ids, _ = rays.intersects_location(edges[start:start + 32, 0], directions[start:start + 32])
        if len(locations):
            distances = np.linalg.norm(locations - edges[start + ids, 0], axis=1)
            _require(not np.any(distances <= lengths[start + ids] + 1e-9), "invalid-mesh", f"{label} has touching or intersecting cavity shells.")
        _require(not any(_coplanar_edge_contact(edge, other, rays) for edge in edges[start:start + 32]),
                 "invalid-mesh", f"{label} has coplanar shell contact.")


def _check_surface(mesh, label, deadline=None):
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
    shell_count, labels = connected_components(graph, directed=False, return_labels=True)
    if shell_count > 1:
        shells = [trimesh.Trimesh(mesh.vertices, mesh.faces[labels == i], process=False) for i in range(shell_count)]
        for shell in shells:
            shell.remove_unreferenced_vertices()
        positive = [i for i, shell in enumerate(shells) if shell.volume > 0]
        _require(len(positive) == 1, "disconnected-mesh", f"{label} must enclose one connected material solid; only inward cavity shells may be separate.")
        outer = positive[0]
        intersectors = [_RayIntersector(shell) for shell in shells]
        for i, shell in enumerate(shells):
            if i != outer:
                _require(shell.volume < 0, "invalid-mesh", f"{label} cavity orientation is invalid.")
                for j, rays in enumerate(intersectors):
                    if i == j:
                        continue
                    contained = contains_points(rays, shell.vertices, check_direction=[0.811107, 0.324443, 0.486664])
                    _require(np.all(contained) if j == outer else not np.any(contained),
                             "invalid-mesh", f"{label} contains intersecting, nested, or external cavity shells.")
            # Containment is directional; boundary intersection is symmetric.
            for j in range(i + 1, len(shells)):
                _require_shells_disjoint(shell, shells[j], intersectors[j], label, deadline)
                _require_shells_disjoint(shells[j], shell, intersectors[i], label, deadline)
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


def _source(request, cell_size, deadline=None):
    value = request.get("mesh")
    _require(isinstance(value, dict) and set(value) == {"vertices", "indices"}, "invalid-input", "mesh requires exactly vertices and indices.")
    raw_vertices, raw_indices = value.get("vertices"), value.get("indices")
    _require(isinstance(raw_vertices, list) and 12 <= len(raw_vertices) and len(raw_vertices) % 3 == 0,
             "invalid-input", "Source vertices require complete XYZ triples for at least four vertices.")
    _require(isinstance(raw_indices, list) and 12 <= len(raw_indices) and len(raw_indices) % 3 == 0,
             "invalid-input", "Source indices require complete triples for at least four triangles.")
    vertices = np.array([_number(x, "mesh coordinate", -100000, 100000) for x in raw_vertices]).reshape(-1, 3)
    _require(all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < len(vertices) for x in raw_indices),
             "invalid-input", "Mesh indices must reference source vertices.")
    origin = vertices.min(axis=0)
    if "voxelGridOriginMm" in request:
        phase = _vector(request["voxelGridOriginMm"], "voxelGridOriginMm", 200000)
        offset = (origin - phase) / cell_size
        nearest = np.rint(offset)
        offset = np.where(np.abs(offset - nearest) <= CELL_TOLERANCE, nearest, np.floor(offset))
        origin = phase + offset * cell_size
    # Cell-scale coordinates keep trimesh's geometric tolerance independent of
    # document scale.  Welding changes adjacency only within 1e-10 cell.
    normalized = trimesh.Trimesh((vertices - origin) / cell_size, np.array(raw_indices).reshape(-1, 3), process=False)
    # Vertex welding preserves face order: captured triangle selections keep
    # addressing the original immutable input rather than transient topology.
    normalized.merge_vertices(digits_vertex=10)
    _check_surface(normalized, "Source mesh", deadline)
    return normalized, origin, float(normalized.volume * cell_size ** 3)


def _boundary_crosses_cell(mesh, index, cell):
    lo = cell.astype(float) + CELL_TOLERANCE
    hi = cell.astype(float) + 1 - CELL_TOLERANCE
    candidate = np.flatnonzero((index.lo[:, 0] < hi[0]) & (index.hi[:, 0] > lo[0])
                              & (index.lo[:, 1] < hi[1]) & (index.hi[:, 1] > lo[1])
                              & (index.lo[:, 2] < hi[2]) & (index.hi[:, 2] > lo[2]))
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
    grid = itertools.product(*(range(int(length)) for length in shape))
    rays = _RayIntersector(mesh)
    # Two deterministic directions agree for a retained centre.  Disagreement
    # conservatively excludes that cell rather than perturbing the mesh.
    directions = ([0.4395064455, 0.617598629942, 0.652231566745], [0.811107, 0.324443, 0.486664])
    cells = []
    while batch := list(itertools.islice(grid, 32)):
        batch = np.asarray(batch)
        points = batch + 0.5
        masks = [contains_points(rays, points, check_direction=d) for d in directions]
        for cell in batch[masks[0] & masks[1]]:
            if not _boundary_crosses_cell(mesh, rays.tree, cell):
                cells.append(cell)
    _require(len(cells) > 0, "resolution-empty", "Cell size is too large to retain a complete source cell.")
    cells = np.asarray(cells)
    _require(_connected(cells), "disconnected-mesh", "Conservative voxelization separates the body; decrease cell size.")
    return cells


def _hex_mesh(cells, origin, cell_size):
    corners = (cells[:, None, :] + HEX_CORNERS).reshape(-1, 3)
    nodes, inverse = np.unique(corners, axis=0, return_inverse=True)
    mesh = MeshHex((origin + nodes * cell_size).T, inverse.reshape(-1, 8).T)
    return mesh, nodes


def _surface(mesh, deadline=None):
    quads = mesh.facets[:, mesh.boundary_facets()].T
    centers = mesh.p.T[quads].mean(axis=1)
    owners = mesh.f2t[0, mesh.boundary_facets()]
    outward = centers - mesh.p.T[mesh.t[:, owners].T].mean(axis=1)
    normals = np.cross(mesh.p.T[quads[:, 1]] - mesh.p.T[quads[:, 0]], mesh.p.T[quads[:, 2]] - mesh.p.T[quads[:, 0]])
    quads[np.einsum("ij,ij->i", normals, outward) < 0] = quads[np.einsum("ij,ij->i", normals, outward) < 0, ::-1]
    triangles = np.vstack((quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]))
    output = trimesh.Trimesh(mesh.p.T, triangles, process=False)
    output.remove_unreferenced_vertices()
    _check_surface(output, "Analyzed cell surface", deadline)
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
    _require(isinstance(supports, list) and len(supports) > 0, "no-support-nodes", "Support regions are required.")
    supports = [_region(region, len(source.faces)) for region in supports]
    cases = request.get("loadCases")
    _require(isinstance(cases, list) and len(cases) > 0, "invalid-input", "Load cases are required.")
    case_regions = []
    for case in cases:
        required = {"name", "region", "forceN"}
        _require(isinstance(case, dict) and required <= case.keys() <= required | {"additionalLoads"},
                 "invalid-input", "Each load case requires name, region, forceN and optional additionalLoads.")
        additional = case.get("additionalLoads", [])
        _require(isinstance(additional, list) and ("additionalLoads" not in case or len(additional) > 0),
                 "invalid-input", "additionalLoads must be a nonempty list when supplied.")
        _require(all(isinstance(term, dict) and set(term) == {"region", "forceN"} for term in additional),
                 "invalid-input", "Additional loads require exactly region and forceN.")
        case_regions.append([_region(term.get("region"), len(source.faces)) for term in [case] + additional])
    regions = request.get("preserveRegions", [])
    _require(isinstance(regions, list), "invalid-input", "Preserve regions must be a list.")
    preserve = [_region(region, len(source.faces)) for region in regions]
    surfaces = [region for region in supports + list(itertools.chain.from_iterable(case_regions)) + preserve if isinstance(region, dict)]
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
    for case, regions in zip(cases, case_regions):
        name = case.get("name")
        _require(isinstance(name, str) and 0 < len(name.strip()) <= 80 and name not in names,
                 "invalid-input", "Load cases require unique nonempty names up to 80 characters.")
        names.add(name)
        terms = []
        for term, region in zip([case] + case.get("additionalLoads", []), regions):
            force = _vector(term.get("forceN"), "forceN", 1e6)
            _require(np.any(force != 0), "invalid-input", "Each load term requires a nonzero resultant force.")
            if isinstance(region, dict):
                mask = _surface_mask(facet_matches, region, surface_band)
            else:
                mask = _within(mesh.p.T[facet_nodes], region, tolerance).all(axis=1)
            _require(np.any(mask), "no-load-facets", "A load region selects no complete exterior FEM facet; adjust its surface selection, bounds, or resolution.")
            selected_nodes = facet_nodes[mask]
            _require(not set(np.unique(selected_nodes)).intersection(fixed.tolist()), "load-support-overlap", "Load facets must not touch clamped support nodes.")
            keys = [frozenset(tuple(p) for p in nodes[quad]) for quad in selected_nodes]
            protected_keys.update(p for key in keys for p in key)
            terms.append({"force": force, "facets": keys})
        loads.append({"name": name, **terms[0], **({"additionalLoads": terms[1:]} if len(terms) > 1 else {})})
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


def _boundary_conditions(request, source, cells, origin, cell_size, deadline):
    reference = request.get("boundaryReferenceMesh")
    condition_request, boundary_source, boundary_cells, boundary_origin = request, source, cells, origin
    if reference is not None:
        # Resolve only original interfaces; new cavity surfaces must never
        # acquire clamps or tractions from the same volumetric selectors.
        condition_request = {**request, "mesh": reference, "preserveRegions": []}
        boundary_source, boundary_origin, _ = _source(condition_request, cell_size, deadline)
        boundary_cells = _voxelize(boundary_source, deadline)
    mesh, nodes = _hex_mesh(boundary_cells, boundary_origin, cell_size)
    fixed, loads, protected = _conditions(condition_request, mesh, nodes, boundary_cells,
                                          cell_size, boundary_source, deadline)
    if reference is None:
        return fixed, loads, protected
    offset = (boundary_origin - origin) / cell_size
    rounded = np.rint(offset)
    _require(np.isfinite(offset).all() and np.all(np.abs(offset - rounded) <= CELL_TOLERANCE),
             "invalid-input", "Boundary reference and analyzed mesh must share the voxel lattice phase.")
    shift = rounded.astype(np.int64)

    def key(point):
        return tuple(np.asarray(point) + shift)

    def term(value):
        return {**value, "facets": [frozenset(key(point) for point in facet) for facet in value["facets"]]}

    mapped_loads = []
    for load in loads:
        mapped = term(load)
        if "additionalLoads" in load:
            mapped["additionalLoads"] = [term(value) for value in load["additionalLoads"]]
        mapped_loads.append(mapped)
    return {key(point) for point in fixed}, mapped_loads, {key(cell) for cell in protected}


def _solve_elasticity(matrix, force, **kwargs):
    diagonal = matrix.diagonal()
    _require(np.isfinite(matrix.data).all() and np.isfinite(force).all() and
             np.isfinite(diagonal).all() and np.all(diagonal > 0),
             "numerical-failure", "The elasticity system has non-finite entries or a nonpositive diagonal.")
    # Avoid sparse LU fill-in in the WASM heap. Connected, fully constrained
    # positive-modulus elasticity is SPD; retain the independent equilibrium check.
    preconditioner = LinearOperator(matrix.shape, matvec=lambda values: values / diagonal)
    displacement, info = cg(matrix, force, M=preconditioner, rtol=1e-10, atol=0)
    _require(info == 0, "numerical-failure",
             f"The iterative elasticity solve did not converge (status {info}; "
             f"{matrix.shape[0]} unknowns, {matrix.nnz} nonzero entries).")
    return displacement


def _evaluate(cells, origin, cell_size, material, fixed_keys, loads, density, deadline, relative_modulus=None, field="strain-energy", sum_cases=False):
    _require(_connected(cells), "disconnected-mesh", "Removal disconnects the analyzed solid.")
    mesh, nodes = _hex_mesh(cells, origin, cell_size)
    surface = _surface(mesh, deadline)
    _require(abs(surface.volume - len(cells) * cell_size ** 3) <= max(1e-8, len(cells) * cell_size ** 3 * 1e-8),
             "invalid-mesh", "Returned surface volume does not match the analyzed cells.")
    # A local translation preserves the geometry while avoiding cancellation in
    # scikit-fem's inverse facet mapping for fine cells far from the world origin.
    analysis_mesh = MeshHex(mesh.p - mesh.p[:, :1], mesh.t)
    basis = Basis(analysis_mesh, ElementVector(ElementHex1()), intorder=3)
    corner_basis = Basis(analysis_mesh, basis.elem, quadrature=(HEX_CORNERS.T.astype(float), np.ones(8)))
    lam, mu = lame_parameters(material[0], material[1])
    scale = 1.0 if relative_modulus is None else relative_modulus[:, None]
    stiffness = asm(linear_elasticity(lam * scale, mu * scale), basis).tocsr()
    node_lookup = {tuple(p): i for i, p in enumerate(nodes)}
    _require(fixed_keys <= node_lookup.keys(), "boundary-condition-lost", "A candidate loses a support node.")
    fixed_nodes = np.array([node_lookup[p] for p in sorted(fixed_keys)])
    fixed_dofs = basis.nodal_dofs[:, fixed_nodes].ravel()
    facets = mesh.boundary_facets()
    facet_lookup = {frozenset(tuple(p) for p in nodes[mesh.facets[:, f]]): f for f in facets}
    energy = np.zeros(len(cells))
    metrics = []
    for load in loads:
        force = np.zeros(basis.N)
        for term in [load] + load.get("additionalLoads", []):
            _require(all(key in facet_lookup for key in term["facets"]), "boundary-condition-lost", "A candidate changes a loaded exterior facet.")
            load_facets = np.array([facet_lookup[key] for key in term["facets"]])
            facet_basis = FacetBasis(analysis_mesh, basis.elem, facets=load_facets, intorder=3)
            area = float(facet_basis.dx.sum())
            traction = term["force"] / area

            @LinearForm
            def distributed_load(v, _):
                return dot(traction[:, None, None], v)

            term_force = asm(distributed_load, facet_basis)
            _require(np.allclose(term_force[basis.nodal_dofs].sum(axis=1), term["force"], rtol=1e-9, atol=1e-9),
                     "numerical-failure", "Integrated load does not match its specified resultant.")
            force += term_force
        try:
            displacement = fem_solve(*condense(stiffness, force, D=fixed_dofs), solver=_solve_elasticity)
        except (RuntimeError, ValueError) as error:
            if isinstance(error, SolverError):
                raise
            raise SolverError("numerical-failure", "The full-solid elasticity solve failed or is singular.") from error
        _require(np.isfinite(displacement).all(), "numerical-failure", "Elasticity returned a non-finite displacement.")
        free = np.setdiff1d(np.arange(basis.N), fixed_dofs)
        residual = (stiffness @ displacement - force)[free]
        _require(np.linalg.norm(residual) <= 1e-8 * max(np.linalg.norm(force[free]), 1e-12),
                 "numerical-failure", "The elasticity equilibrium residual exceeds its tolerance.")
        strain = sym_grad(basis.interpolate(displacement))
        corner_strain = sym_grad(corner_basis.interpolate(displacement))
        _require(relative_modulus is not None or max(float(np.sqrt(np.sum(values ** 2, axis=(0, 1))).max())
                     for values in (strain, corner_strain)) <= 0.05,
                 "small-strain-limit", "The solution exceeds the supported small-strain regime.")
        stress = linear_stress(lam * scale, mu * scale)(strain)
        corner_stress = linear_stress(lam * scale, mu * scale)(corner_strain)
        maxima = []
        # On axis-aligned Q1 cells, every stress component is multi-affine.
        # The convex von Mises norm therefore attains its element maximum at a
        # corner.  Keep discontinuous element-corner values without averaging.
        cell_stress = np.zeros(len(cells))
        for values in (stress, corner_stress):
            mean = np.trace(values, axis1=0, axis2=1) / 3
            deviator = values - np.eye(3)[:, :, None, None] * mean[None, None, :, :]
            local = np.sqrt(1.5 * np.sum(deviator ** 2, axis=(0, 1))).max(axis=1)
            cell_stress = np.maximum(cell_stress, local)
            maxima.append(float(local.max()))
        max_stress = max(maxima)
        max_displacement = float(np.linalg.norm(displacement[basis.nodal_dofs], axis=0).max())
        compliance = float(force @ displacement)
        _require(math.isfinite(max_stress) and math.isfinite(compliance) and max_stress > 0 and compliance > 0,
                 "numerical-failure", "Elasticity produced invalid stress or energy.")
        local_energy = (cell_stress if field == "von-mises" else
                        np.sum(np.sum(stress * strain, axis=(0, 1)) * basis.dx, axis=1))
        energy = energy + local_energy if sum_cases else np.maximum(energy, local_energy)
        metrics.append({"name": load["name"], "maxVonMisesMpa": max_stress,
                        "maxDisplacementMm": max_displacement, "safetyFactor": material[2] / max_stress,
                        "complianceNmm": compliance})
    return {"volumeMm3": float(len(cells) * cell_size ** 3),
            "massKg": float(len(cells) * cell_size ** 3 * density * 1e-9),
            "maxVonMisesMpa": max(case["maxVonMisesMpa"] for case in metrics),
            "maxDisplacementMm": max(case["maxDisplacementMm"] for case in metrics),
            "safetyFactor": min(case["safetyFactor"] for case in metrics), "cases": metrics}, energy, surface


def _baseline_failure_message(metrics, yield_strength, safety_factor, max_displacement):
    violations = []
    index, case = min(enumerate(metrics["cases"]), key=lambda item: item[1]["safetyFactor"])
    if case["safetyFactor"] < safety_factor:
        violations.append((index, case["name"], f"von Mises stress {case['maxVonMisesMpa']} MPa exceeds allowable "
                           f"{yield_strength / safety_factor} MPa; safety factor {case['safetyFactor']} is below required {safety_factor}"))
    index, case = max(enumerate(metrics["cases"]), key=lambda item: item[1]["maxDisplacementMm"])
    if case["maxDisplacementMm"] > max_displacement:
        violations.append((index, case["name"], f"maximum displacement {case['maxDisplacementMm']} mm exceeds limit {max_displacement} mm"))

    def render(labels):
        return "The conservative full-solid baseline is infeasible. " + ". ".join(
            f"load case {index + 1}{label}: {detail}" for (index, _, detail), label in zip(violations, labels)) + "."

    labels = [""] * len(violations)
    # Keep metrics and ordinals intact within the downstream automation envelope.
    remaining = 512 - len(render(labels))
    for position, (_, name, _) in enumerate(violations):
        budget = remaining // (len(violations) - position)
        for length in range(len(name), 0, -1):
            excerpt = name[:length] + ("..." if length < len(name) else "")
            # ASCII escapes make this budget identical to JavaScript string length.
            label = " " + json.dumps(excerpt)
            if len(label) <= budget:
                labels[position] = label
                remaining -= len(label)
                break
    return render(labels)


def _sensitivity_filter(cells, radius, deadline):
    tree = cKDTree(cells.astype(float))
    pointers, cols, values = [0], [], []
    for point in cells:
        neighbors = np.asarray(tree.query_ball_point(point, radius), dtype=np.int64)
        weights = radius - np.linalg.norm(cells[neighbors] - point, axis=1)
        cols.append(neighbors)
        values.append(np.maximum(weights, 0))
        pointers.append(pointers[-1] + len(neighbors))
    matrix = sparse.csr_matrix((np.concatenate(values), np.concatenate(cols), np.asarray(pointers)),
                              shape=(len(cells), len(cells)))
    matrix.sort_indices()
    return matrix, np.asarray(matrix.sum(axis=1)).ravel()


def _oc_update(rho, derivative, frozen, budget):
    """Bounded optimality-criteria update for the sensitivity-filtered design."""
    lo, hi = 0.0, max(1.0, float(np.max(-derivative)) * 1000)
    result = rho.copy()
    for _ in range(80):
        multiplier = (lo + hi) / 2
        result = np.clip(rho * np.sqrt(np.maximum(-derivative, 1e-30) / multiplier),
                         np.maximum(0.001, rho - 0.2), np.minimum(1.0, rho + 0.2))
        result[frozen] = 1.0
        if result.sum() > budget:
            lo = multiplier
        else:
            hi = multiplier
    return result


def _simp_density(cells, frozen, algorithm, max_iterations, evaluate, deadline, baseline_field):
    n = len(cells)
    target = math.ceil(n * algorithm["volumeFraction"])
    free = int((~frozen).sum())
    evidence = {"kind": "simp", "settings": algorithm, "densityIterations": 0,
                "converged": False, "maxDensityChange": 1.0,
                "targetCellCount": target, "achievedCellCount": n, "targetStatus": "not-reached",
                "projectionEvaluations": 0}
    warnings = []
    minimum_budget = float(frozen.sum()) + 0.001 * free
    if target <= minimum_budget:
        # A constant minimum-density field has no design freedom or useful
        # density ranking. Retain the verified baseline field without a solve.
        if target < n:
            warnings.append("The requested SIMP target leaves no adjustable density budget above protected cells and minimum free densities. Density search was skipped; binary projections use verified baseline FEM energy and may retain more material than requested. Full-solid constraints and repeated final verification still apply.")
        return baseline_field, evidence, warnings
    budget = float(target)
    rho = np.full(n, max(0.001, (budget - frozen.sum()) / max(1, free)))
    rho[frozen] = 1
    iterations, change = 0, 1.0
    verified_ranking = baseline_field
    matrix, sums = _sensitivity_filter(cells, algorithm["filterRadiusMm"] / evaluate.cell_size, deadline)
    for i in range(max_iterations):
        modulus = 1e-6 + (1 - 1e-6) * rho ** algorithm["penalty"]
        # Evaluation evidence counts an attempted density iterate even on failure.
        iterations = i + 1
        try:
            _, energy, _ = evaluate(cells, relative_modulus=modulus, sum_cases=True)
        except SolverError as error:
            if error.code != "numerical-failure":
                raise
            # A failed relaxed solve contributes no ranking or feasibility
            # evidence. Retain verified ranking and still analyze every solid.
            rho = verified_ranking
            warnings.append("SIMP density search stopped after a numerical failure in a relaxed solve. Binary projections use the last verified density ranking, or baseline FEM energy when no density solve succeeded; every accepted solid still passes full-solid constraints and repeated final verification.")
            break
        verified_ranking = rho.copy()
        derivative = -algorithm["penalty"] * (1 - 1e-6) * rho ** (algorithm["penalty"] - 1) * energy / modulus
        derivative = np.asarray(matrix @ (rho * derivative)).ravel() / (sums * np.maximum(rho, 0.001))
        updated = _oc_update(rho, derivative, frozen, budget)
        change = float(np.max(np.abs(updated - rho)))
        rho = updated
        if change <= 0.01:
            break
    evidence.update(densityIterations=iterations, converged=iterations > 0 and change <= 0.01,
                    maxDensityChange=change)
    return rho, evidence, warnings


def _coverage_opening(mask, cells, cube_cells):
    """Union of fully occupied k-cubes, using SciPy morphology."""
    from scipy.ndimage import binary_opening
    shape = cells.max(axis=0) + 1
    grid = np.zeros(tuple(shape), dtype=bool)
    grid[tuple(cells[mask].T)] = True
    opened = binary_opening(grid, structure=np.ones((cube_cells,) * 3, dtype=bool))
    return opened[tuple(cells.T)]


def _tpms_field(cells, cell_size, algorithm, energy):
    # Standard nodal TPMS approximations; the local gradient only maps a
    # requested wall width to an implicit threshold. Occupied-cell cube coverage
    # below supplies the actual discrete minimum-feature acceptance condition.
    xyz = (cells + 0.5) * (2 * np.pi * cell_size / algorithm["cellPeriodMm"])
    x, y, z = xyz.T
    sx, sy, sz = np.sin(x), np.sin(y), np.sin(z)
    cx, cy, cz = np.cos(x), np.cos(y), np.cos(z)
    if algorithm["lattice"] == "gyroid":
        value = sx * cy + sy * cz + sz * cx
        gradient = np.array([cx * cy - sz * sx, cy * cz - sx * sy, cz * cx - sy * sz]).T
    elif algorithm["lattice"] == "schwarz-p":
        value = cx + cy + cz
        gradient = np.array([-sx, -sy, -sz]).T
    else:
        value = sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz
        gradient = np.array([cx * sy * sz + cx * cy * cz - sx * sy * cz - sx * cy * sz,
                             sx * cy * sz - sx * sy * cz + cx * cy * cz - cx * sy * sz,
                             sx * sy * cz - sx * cy * sz - cx * sy * sz + cx * cy * cz]).T
    distance = np.abs(value) / np.maximum(np.linalg.norm(gradient, axis=1), 1e-12) * algorithm["cellPeriodMm"] / (2 * np.pi)
    normalized = energy / max(float(energy.max()), 1e-30)
    walls = algorithm["minWallThicknessMm"] + (algorithm["maxWallThicknessMm"] - algorithm["minWallThicknessMm"]) * normalized ** algorithm["gamma"]
    return distance, walls


def _protect_cube_coverage(cells, frozen, cube_cells, deadline):
    """Thicken frozen interfaces by retaining complete baseline k-cubes."""
    shape = cells.max(axis=0) + 1
    if np.any(shape < cube_cells) or cube_cells ** 3 > len(cells):
        raise SolverError("infeasible-baseline", "The baseline cannot resolve the requested TPMS minimum thickness.")
    occupied = np.zeros(tuple(shape), dtype=np.int32)
    occupied[tuple(cells.T)] = 1
    prefix = np.pad(occupied, ((1, 0),) * 3).cumsum(0).cumsum(1).cumsum(2)
    sums = np.zeros(tuple(shape - cube_cells + 1), dtype=np.int32)
    for bits in itertools.product((0, 1), repeat=3):
        slices = tuple(slice(cube_cells, None) if bit else slice(None, -cube_cells) for bit in bits)
        sums += (-1) ** (3 - sum(bits)) * prefix[slices]
    anchors = np.argwhere(sums == cube_cells ** 3)
    grid = np.zeros(tuple(shape), dtype=bool)
    for cell in cells[frozen]:
        possible = anchors[np.all((anchors <= cell) & (anchors + cube_cells > cell), axis=1)]
        _require(len(possible) > 0, "infeasible-baseline", "A protected TPMS interface cannot meet the resolved minimum thickness.")
        distances = np.sum((possible + cube_cells / 2 - cell - 0.5) ** 2, axis=1)
        anchor = possible[np.argmin(distances)]
        grid[tuple(slice(int(a), int(a + cube_cells)) for a in anchor)] = True
    return grid[tuple(cells.T)] | frozen


def _skin_mask(cells, cell_size, thickness):
    if thickness == 0:
        return np.zeros(len(cells), dtype=bool)
    # Chebyshev distance preserves complete boundary layers, including cavity
    # interfaces, rounded outwards to whole cells.
    grid = np.zeros(tuple(cells.max(axis=0) + 3), dtype=bool)
    grid[tuple((cells + 1).T)] = True
    distance = distance_transform_cdt(grid, metric="chessboard")[tuple((cells + 1).T)]
    return distance <= math.ceil(thickness / cell_size)


def _algorithm_search(cells, protected, origin, cell_size, algorithm, max_iterations,
                      target_count, baseline_field, evaluate, feasible, fdm_context, deadline):
    original = cells
    frozen = np.array([tuple(cell) in protected for cell in original])
    projections = 0
    iterations = 0
    lattice_context = None
    warnings = []
    if algorithm["kind"] == "simp":
        rho, evidence, warnings = _simp_density(original, frozen, algorithm, max_iterations, evaluate, deadline, baseline_field)
        iterations = evidence["densityIterations"]
        target = evidence["targetCellCount"]
        rank = np.flatnonzero(~frozen)
        rank = rank[np.argsort(-rho[rank], kind="stable")]
        # Projection restores in density order when a lower-volume binary solid
        # fails. No relaxed stress/displacement metric is used for acceptance.
        minimum = max(target, int(frozen.sum()))
        if warnings and max_iterations and minimum < len(original):
            # An unavailable relaxed search still gets budgeted high-density trials,
            # including one-cell removal, rather than jumping to the full solid.
            removals = np.ceil(np.geomspace(len(original) - minimum, 1, max_iterations)).astype(int)
            counts = np.unique(np.r_[len(original) - removals, len(original)])
        else:
            counts = np.unique(np.ceil(np.linspace(minimum, len(original), max_iterations + 1)).astype(int))
        candidates = []
        for count in counts:
            mask = frozen.copy()
            mask[rank[:max(0, count - int(frozen.sum()))]] = True
            candidates.append(mask)
    else:
        distance, walls = _tpms_field(original, cell_size, algorithm, baseline_field)
        skin = _skin_mask(original, cell_size, algorithm["skinThicknessMm"])
        frozen |= skin
        frozen = _protect_cube_coverage(original, frozen, math.ceil(algorithm["minWallThicknessMm"] / cell_size), deadline)
        # The original solid is the implicit feasible fallback. Only budgeted
        # nonzero thresholds count as search passes; final FEM repeats the fallback.
        multipliers = np.linspace(1, 0, max_iterations + 1)[:-1]
        candidates = []
        cube_cells = math.ceil(algorithm["minWallThicknessMm"] / cell_size)
        lattice_context = {"k": cube_cells, "settings": {"minFeatureSizeMm": algorithm["minWallThicknessMm"]}}
        evidence = {"kind": "adaptive-lattice", "settings": algorithm,
                    "fieldMin": float(baseline_field.min()), "fieldMax": float(baseline_field.max()),
                    "requestedWallMinMm": float(walls.min()), "requestedWallMaxMm": float(walls.max()),
                    "minimumFeatureSizeBoundMm": 0.0, "projectionEvaluations": 0, "thresholdPasses": 0}
        for multiplier in multipliers:
            # Decrease removal by expanding the field-based implicit threshold.
            cutoff = walls / 2 + (1 - multiplier) * algorithm["cellPeriodMm"] / 2
            mask = (distance <= cutoff) | frozen
            mask = _coverage_opening(mask, original, cube_cells)
            # Protected and skin cells may never be lost by morphology. A failed
            # coverage candidate is rejected instead of silently thinning them.
            if np.all(mask[frozen]):
                candidates.append(mask)
    termination = "iteration-limit" if max_iterations == 0 else "constraints-or-topology"
    if max_iterations:
        for mask in candidates:
            candidate = original[mask]
            if not len(candidate) or (target_count is not None and len(candidate) < target_count):
                continue
            if lattice_context is not None:
                evidence["thresholdPasses"] += 1
            if fdm_context is not None and not _fdm_feasible(_fdm_metrics(candidate, origin, cell_size, fdm_context, deadline), fdm_context):
                continue
            try:
                projections += 1
                metrics, _, _ = evaluate(candidate)
                if feasible(metrics):
                    cells = candidate
                    break
            except SolverError as error:
                if error.code not in {"disconnected-mesh", "invalid-mesh", "numerical-failure", "small-strain-limit", "boundary-condition-lost"}:
                    raise
    if np.all(frozen):
        termination = "no-removable-cells"
    if target_count is not None and len(cells) == target_count:
        termination = "target-mass-reached"
    evidence["projectionEvaluations"] = projections
    if algorithm["kind"] == "simp":
        evidence["achievedCellCount"] = len(cells)
        evidence["targetStatus"] = "reached" if len(cells) == evidence["targetCellCount"] else "not-reached"
    else:
        iterations = evidence["thresholdPasses"]
        bound = _fdm_feature_bound(cells, origin, cell_size, lattice_context)
        _require(bound >= algorithm["minWallThicknessMm"], "infeasible-baseline", "TPMS minimum thickness cannot be represented by filled voxel cubes at this resolution.")
        evidence["minimumFeatureSizeBoundMm"] = bound
    return cells, evidence, iterations, termination, frozen, original, warnings


def solve(request):
    """Optimize one source mesh, returning only a repeatedly verified feasible mesh."""
    _require(isinstance(request, dict) and request.get("schemaVersion") == 1,
             "invalid-input", "Only structural request schemaVersion 1 is supported.")
    required = {"schemaVersion", "mesh", "material", "safetyFactor", "maxDisplacementMm", "cellSizeMm", "supports", "loadCases", "preserveRegions", "maxIterations"}
    _require(required <= request.keys() and request.keys() <= required | {"objective", "fdm", "obstacleRegions", "algorithm", "relativePerformance", "includeVoxelGrid", "voxelGridOriginMm", "boundaryReferenceMesh"},
             "invalid-input", "Structural requests require exactly the supported settings.")
    _require(type(request["schemaVersion"]) is int, "invalid-input", "schemaVersion must be the integer 1.")
    _require("includeVoxelGrid" not in request or type(request["includeVoxelGrid"]) is bool,
             "invalid-input", "includeVoxelGrid must be a boolean when supplied.")
    deadline = None
    objective = _objective(request)
    relative_performance = _relative_performance(request)
    fdm_settings = _fdm_settings(request)
    cell_size = _number(request.get("cellSizeMm"), "cellSizeMm", 0.01, 100000)
    algorithm = _algorithm(request, cell_size, objective)
    _require(fdm_settings is None or fdm_settings["layerHeightMm"] <= cell_size,
             "invalid-input", "FDM layer height must not exceed the voxel cell size for one-slice support coverage.")
    max_displacement = _number(request.get("maxDisplacementMm"), "maxDisplacementMm", 1e-9, 100000)
    safety_factor = _number(request.get("safetyFactor"), "safetyFactor", 1, 100)
    max_iterations = request.get("maxIterations")
    _require(isinstance(max_iterations, int) and not isinstance(max_iterations, bool) and max_iterations >= 0,
             "invalid-input", "maxIterations must be a nonnegative integer.")
    if "boundaryReferenceMesh" in request:
        _require(isinstance(request["boundaryReferenceMesh"], dict) and max_iterations == 0
                 and not any(key in request for key in ("algorithm", "objective", "relativePerformance"))
                 and isinstance(request["preserveRegions"], list) and not request["preserveRegions"],
                 "invalid-input", "A boundary reference requires fixed-design analysis without search settings or preserved design regions.")
    material = request.get("material")
    _require(isinstance(material, dict) and set(material) == {"youngModulusMpa", "poissonRatio", "yieldStrengthMpa", "densityKgM3"}, "invalid-input", "material requires exactly the supported isotropic properties.")
    parameters = (_number(material.get("youngModulusMpa"), "youngModulusMpa", 1e-3, 1e6),
                  _number(material.get("poissonRatio"), "poissonRatio", 0, 0.45),
                  _number(material.get("yieldStrengthMpa"), "yieldStrengthMpa", 1e-6, 1e5))
    density = _number(material.get("densityKgM3"), "densityKgM3", 1e-3, 1e5)
    obstacles = _obstacle_regions(request)
    source, origin, source_volume = _source(request, cell_size, deadline)
    cells = _voxelize(source, deadline)
    # Resolve authored boundaries against the original captured-source baseline;
    # exclusion must never remap a load or support onto a newly exposed cavity.
    fixed_keys, loads, protected = _boundary_conditions(request, source, cells, origin, cell_size, deadline)
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

    def absolute_feasible(metrics):
        return metrics["safetyFactor"] >= safety_factor and metrics["maxDisplacementMm"] <= max_displacement

    baseline, energy, _ = _evaluate(cells, origin, cell_size, parameters, fixed_keys, loads, density, deadline,
                                    field=algorithm["field"] if algorithm and algorithm["kind"] == "adaptive-lattice" else "strain-energy")
    if not absolute_feasible(baseline):
        raise SolverError("infeasible-baseline", _baseline_failure_message(baseline, parameters[2], safety_factor, max_displacement))

    def feasible(metrics):
        return absolute_feasible(metrics) and _relative_feasible(metrics, baseline, relative_performance)

    _require(feasible(baseline), "numerical-failure", "Baseline cases require positive finite stiffness and stress for relative performance.")
    evaluations, iterations = 1, 0
    termination = "iteration-limit"
    algorithm_evidence = None
    algorithm_frozen = None
    algorithm_original = None
    algorithm_warnings = []
    if algorithm is not None:
        def evaluate(candidate, **options):
            nonlocal evaluations
            evaluations += 1
            return _evaluate(candidate, origin, cell_size, parameters, fixed_keys, loads, density, deadline, **options)
        evaluate.cell_size = cell_size
        cells, algorithm_evidence, iterations, termination, algorithm_frozen, algorithm_original, algorithm_warnings = _algorithm_search(
            cells, protected, origin, cell_size, algorithm, max_iterations, target_count, energy,
            evaluate, feasible, fdm_context, deadline)
    for iteration in range(max_iterations if algorithm is None else 0):
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
    # Snapshot encoding keeps the strict STL rounding gate and uses exact-coordinate
    # 3MF when necessary. The validated raw surface remains the analyzed geometry.
    _require(feasible(optimized), "final-verification-failed", "Repeated final full-solid analysis violates a constraint.")
    _require(optimized["volumeMm3"] <= baseline["volumeMm3"] + 1e-8,
             "final-verification-failed", "The final volume exceeds the baseline.")
    _require(not np.any(_obstacle_mask(cells, origin, cell_size, obstacles)),
             "final-verification-failed", "The final analyzed cells intersect a keep-out box.")
    _require(protected <= {tuple(cell) for cell in cells}, "final-verification-failed", "The final analyzed cells lose a protected region.")
    if algorithm_frozen is not None:
        _require({tuple(cell) for cell in algorithm_original[algorithm_frozen]} <= {tuple(cell) for cell in cells},
                 "final-verification-failed", "The final analyzed cells lose a protected interface or requested skin.")
    if algorithm and algorithm["kind"] == "adaptive-lattice":
        bound = _fdm_feature_bound(cells, origin, cell_size, {"k": math.ceil(algorithm["minWallThicknessMm"] / cell_size),
                                  "settings": {"minFeatureSizeMm": algorithm["minWallThicknessMm"]}})
        _require(bound >= algorithm["minWallThicknessMm"], "final-verification-failed", "Repeated TPMS minimum-feature verification failed.")
        algorithm_evidence["minimumFeatureSizeBoundMm"] = bound
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
                         if any(region.get("kind") == "surface" for region in request["supports"] +
                                [term["region"] for case in request["loadCases"] for term in [case] + case.get("additionalLoads", [])] +
                                request.get("preserveRegions", [])) else [])}
    if relative_performance is not None:
        result["relativePerformance"] = relative_performance
    result["warnings"].extend(algorithm_warnings)
    if algorithm_evidence is not None:
        result["algorithm"] = algorithm_evidence
        result["warnings"][1] = ("SIMP uses E(rho)=E0*(1e-6+(1-1e-6)*rho^penalty), sensitivity filtering, summed load-case compliance, and bounded optimality-criteria updates. Binary projection can miss its volume target; density convergence does not establish solid optimality."
                                 if algorithm["kind"] == "simp" else
                                 "TPMS uses a conservative maximum baseline FEM field across load cases and a local-gradient implicit threshold. Walls and skins are voxel approximations; filled-cube coverage bounds discrete minimum features, not smooth-wall accuracy. Threshold expansion may return the full baseline when constraints prevent a feasible lattice.")
    if fdm_context is not None:
        result["fdm"] = {"settings": fdm_settings, "approximation": "conservative-voxel",
                         "minimumFeatureCubeCells": fdm_context["k"], "horizontalReachMm": fdm_context["reach"],
                         "buildPlateCoordinateMm": fdm_context["plate"],
                         "baseline": baseline_fdm, "optimized": optimized_fdm}
        result["warnings"].extend([
            "FDM feature coverage first proves the union of full cubes with nominal k=ceil(minFeatureSizeMm/cellSizeMm). It tries one larger cube size only if nominal coverage fails. Every occupied voxel must belong to a full selected-size cube meeting the exact requested minimum in raw and float32 coordinates.",
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
    if request.get("includeVoxelGrid") is True:
        result["voxelGrid"] = {"originMm": origin.tolist(), "cellSizeMm": cell_size, "cells": cells.tolist()}
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
