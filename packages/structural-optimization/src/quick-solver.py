"""Load-free TPMS nodal geometry; no stiffness or load-capacity prediction."""

import json
import math
import numpy as np
import trimesh
from scipy import ndimage, sparse
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

_QUICK_CONTEXT = None
_QUICK_PROGRESS = None
_QUICK_SAMPLE = None
_MAX_BATCH_PAIRS = 262144


class QuickError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _ensure(condition, code, message):
    if not condition:
        raise QuickError(code, message)


def _finite(value, name, lower=-math.inf, upper=math.inf):
    _ensure(isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and lower <= value <= upper,
            "invalid-input", f"{name} is outside its supported range.")
    return float(value)


class _SpatialTriangleIndex:
    """Conservative broad phase for trimesh without its native rtree dependency.

    Triangle AABBs are enclosed by spheres for cKDTree queries; exact box overlap
    filters their superset. Trimesh still owns distance and ray intersection math.
    """

    def __init__(self, triangles):
        self.lo = triangles.min(axis=1)
        self.hi = triangles.max(axis=1)
        self.centers = (self.lo + self.hi) / 2
        self.radius = float(np.linalg.norm(self.hi - self.lo, axis=1).max() / 2)
        self.tree = cKDTree(self.centers)
        self.bounds = np.r_[self.lo.min(axis=0), self.hi.max(axis=0)]

    def intersection(self, bounds):
        bounds = np.asarray(bounds)
        center = (bounds[:3] + bounds[3:]) / 2
        radius = np.linalg.norm(bounds[3:] - bounds[:3]) / 2 + self.radius + 1e-8
        candidate = np.asarray(self.tree.query_ball_point(center, radius), dtype=np.int64)
        for axis in range(3):
            if len(candidate):
                candidate = candidate[(self.lo[candidate, axis] <= bounds[axis + 3])
                                      & (self.hi[candidate, axis] >= bounds[axis])]
        return candidate


def _surface_components(mesh, label):
    _ensure(len(mesh.faces) >= 4 and mesh.is_watertight and mesh.is_winding_consistent,
            "invalid-mesh", f"{label} must be a closed oriented manifold. Increase the detail cell size for a generated result.")
    _ensure(np.all(mesh.area_faces > 1e-12), "invalid-mesh",
            f"{label} contains degenerate triangles.")
    edges, counts = np.unique(np.sort(mesh.edges, axis=1), axis=0, return_counts=True)
    _ensure(np.all(counts == 2), "invalid-mesh", f"{label} has nonmanifold edges.")
    adjacency = mesh.face_adjacency
    graph = sparse.coo_matrix((np.ones(len(adjacency) * 2),
                              (np.r_[adjacency[:, 0], adjacency[:, 1]],
                               np.r_[adjacency[:, 1], adjacency[:, 0]])),
                             shape=(len(mesh.faces), len(mesh.faces)))
    count, labels = connected_components(graph, directed=False)
    # A closed edge manifold may still contain two face fans pinched at a vertex.
    fans = [[] for _ in mesh.vertices]
    for face, vertices in enumerate(mesh.faces):
        for vertex in vertices:
            fans[vertex].append(face)
    links = [[] for _ in mesh.vertices]
    for pair, edge in zip(adjacency, mesh.face_adjacency_edges):
        for vertex in edge:
            links[vertex].append(tuple(pair))
    for faces, pairs in zip(fans, links):
        if not faces:
            continue
        linked, pending = {faces[0]}, list(pairs)
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
        _ensure(len(linked) == len(faces), "invalid-mesh", f"{label} has a nonmanifold vertex.")
    return count, labels


def _query_batch_size(mesh):
    # Trimesh casts rays in both directions. Target bounded pair scratch arrays,
    # with at least one query point; dense sources can exceed the pair target.
    return max(1, min(128, _MAX_BATCH_PAIRS // (2 * len(mesh.faces))))


def _report_progress(phase, completed, total):
    if _QUICK_PROGRESS is not None and total:
        _QUICK_PROGRESS(phase, completed, total)


def _distances(context, points, phase="validation"):
    pieces = []
    accelerated = phase == "sampling" and _QUICK_SAMPLE is not None
    batch_size = 8192 if accelerated else _query_batch_size(context["source"])
    _report_progress(phase, 0, len(points))
    for start in range(0, len(points), batch_size):
        end = min(start + batch_size, len(points))
        samples = points[start:end]
        if phase == "sampling":
            bounds = context["source"].bounds
            inside_bounds = np.all((samples >= bounds[0]) & (samples <= bounds[1]), axis=1)
            # Outside samples cannot share a positive-envelope cube: the inset is
            # at least one cell diagonal. Their negative magnitude is irrelevant.
            distance = np.full(len(samples), -1.0)
            if np.any(inside_bounds):
                selected = samples[inside_bounds]
                if accelerated:
                    signed = np.asarray(_QUICK_SAMPLE(selected.ravel()).to_py(), dtype=np.float64)
                    _ensure(signed.shape == (len(selected),), "invalid-result", "The sampling response has the wrong shape.")
                    unresolved = ~np.isfinite(signed)
                    if np.any(unresolved):
                        pending = np.flatnonzero(unresolved)
                        fallback_batch = _query_batch_size(context["source"])
                        for offset in range(0, len(pending), fallback_batch):
                            indices = pending[offset:offset + fallback_batch]
                            signed[indices] = trimesh.proximity.signed_distance(context["source"], selected[indices])
                    distance[inside_bounds] = signed
                else:
                    distance[inside_bounds] = trimesh.proximity.signed_distance(context["source"], selected)
        else:
            distance = trimesh.proximity.signed_distance(context["source"], samples)
        pieces.append(distance)
        _report_progress(phase, end, len(points))
    return np.concatenate(pieces) if pieces else np.empty(0)


def _contains(mesh, points):
    batch_size = _query_batch_size(mesh)
    pieces = []
    _report_progress("validation", 0, len(points))
    for start in range(0, len(points), batch_size):
        end = min(start + batch_size, len(points))
        pieces.append(mesh.contains(points[start:end]))
        _report_progress("validation", end, len(points))
    return np.concatenate(pieces) if pieces else np.empty(0, dtype=bool)


def _prepare(request):
    required = {
        "schemaVersion", "mesh", "mode", "removalPercent", "cellSizeMm", "skinThicknessMm"
    }
    optional = {"cellType", "latticeCellSizeMm"}
    _ensure(isinstance(request, dict) and required <= set(request) <= required | optional
            and request["schemaVersion"] == 1, "invalid-input", "Quick lightweighting requires schema version 1 and its supported settings.")
    mode = request["mode"]
    _ensure(mode in ("preserve-exterior", "open-organic"), "invalid-input", "Unknown lightweighting mode.")
    cell = _finite(request["cellSizeMm"], "cellSizeMm")
    _ensure(cell > 0, "invalid-input", "cellSizeMm must be positive.")
    cell_type = request.get("cellType", "gyroid")
    _ensure(cell_type in ("gyroid", "schwarz-p", "schwarz-d"), "invalid-input", "Unknown lattice cell type.")
    default_samples = 12 if cell_type == "schwarz-d" else 6
    period = _finite(request.get("latticeCellSizeMm", cell * default_samples), "latticeCellSizeMm")
    _ensure(period > 0, "invalid-input", "latticeCellSizeMm must be positive.")
    period_samples = period / cell if "latticeCellSizeMm" in request else default_samples
    _ensure(period_samples >= 6 - 1e-8, "invalid-input",
            "A lattice cell requires at least six sampling cells.")
    skin = _finite(request["skinThicknessMm"], "skinThicknessMm", 0)
    removal = _finite(request["removalPercent"], "removalPercent")
    _ensure(0 < removal < 100, "invalid-input", "removalPercent must be greater than zero and less than 100.")
    _ensure(mode != "preserve-exterior" or skin >= 2 * cell, "invalid-input",
            "Preserving the exterior requires skin thickness of at least two detail cells.")
    mesh = request["mesh"]
    _ensure(isinstance(mesh, dict) and set(mesh) == {"vertices", "indices"}, "invalid-input", "A captured source mesh is required.")
    vertices, indices = mesh["vertices"], mesh["indices"]
    _ensure(isinstance(vertices, list) and 12 <= len(vertices) and len(vertices) % 3 == 0,
            "invalid-input", "Source vertices require complete XYZ triples for at least four vertices.")
    _ensure(isinstance(indices, list) and 12 <= len(indices) and len(indices) % 3 == 0,
            "invalid-input", "Source indices require complete triples for at least four triangles.")
    original = np.array([_finite(value, "coordinate", -100000, 100000) for value in vertices]).reshape(-1, 3)
    _ensure(all(isinstance(value, int) and not isinstance(value, bool) and 0 <= value < len(original) for value in indices),
            "invalid-input", "Source indices must reference captured vertices.")
    origin = original.min(axis=0)
    normalized = (original - origin) / cell
    _ensure(np.all(np.isfinite(normalized)), "invalid-input",
            "The source cannot be represented at the requested detail scale.")
    resolution = int(math.ceil(float(normalized.max()))) + 7
    context = {"request": request, "origin": origin, "cell": cell, "resolution": resolution,
               "cellType": cell_type, "latticeCellSizeMm": period}
    source = trimesh.Trimesh(normalized, np.array(indices).reshape(-1, 3), process=False)
    source.merge_vertices(digits_vertex=10)
    count, _ = _surface_components(source, "Source mesh")
    _ensure(count == 1 and source.is_volume, "disconnected-mesh",
            "Choose one closed positive-volume solid without separate shells or existing cavities.")
    context["source"] = source
    source._cache["triangles_tree"] = _SpatialTriangleIndex(source.triangles)
    context["sourceVolume"] = float(source.volume * cell ** 3)
    # Every interior ball fits inside the source AABB. This is an upper bound,
    # never a sampled estimate or a reason to reject an inconclusive source.
    inset = (skin / cell if mode == "preserve-exterior" else 0) + math.sqrt(3)
    clearance_bound = float(np.min(source.extents) / 2)
    _ensure(clearance_bound + 1e-8 > inset, "no-removable-material",
            f"Source bounds limit interior clearance to {clearance_bound * cell:g} mm, "
            f"below the required skin and sampling margin of {inset * cell:g} mm. "
            "Use finer detail cells or reduce skin thickness.")
    z, y, x = np.indices((resolution,) * 3, dtype=np.float64) - 3
    points = np.column_stack((x.ravel(), y.ravel(), z.ravel()))
    del x, y, z
    distances = _distances(context, points, "sampling")
    _ensure(np.all(np.isfinite(distances)), "invalid-mesh", "The source signed distance is not finite.")
    points *= 2 * math.pi / period_samples
    points += np.array([0.37, 0.73, 1.11])
    gx, gy, gz = points.T
    # Nodal approximations in https://doi.org/10.1038/s41467-020-17570-1,
    # Methods equations 1-3. The existing construction retains a band |F| <= t.
    if cell_type == "gyroid":
        lattice = np.sin(gx) * np.cos(gy) + np.sin(gy) * np.cos(gz) + np.sin(gz) * np.cos(gx)
        amplitude = 1.5
    elif cell_type == "schwarz-p":
        lattice = np.cos(gx) + np.cos(gy) + np.cos(gz)
        amplitude = 3.0
    else:
        lattice = (np.sin(gx) * np.sin(gy) * np.sin(gz)
                   + np.sin(gx) * np.cos(gy) * np.cos(gz)
                   + np.cos(gx) * np.sin(gy) * np.cos(gz)
                   + np.cos(gx) * np.cos(gy) * np.sin(gz))
        amplitude = math.sqrt(2)
    np.abs(lattice, out=lattice)
    # One cell diagonal conservatively contains every reconstructed triangle,
    # including interpolation over a curved or concave captured source boundary.
    envelope = distances - inset
    clearance_mm = float(distances.max() * cell)
    margin_mm = math.sqrt(3) * cell
    if mode == "preserve-exterior":
        _ensure(np.any(envelope > 0), "no-removable-material",
                f"Maximum sampled interior clearance {clearance_mm:g} mm does not exceed "
                f"the preserved skin {skin:g} mm plus sampling margin {margin_mm:g} mm "
                f"({skin + margin_mm:g} mm total). Use finer detail cells or reduce skin thickness.")
    else:
        _ensure(np.any(envelope > 0), "no-removable-material",
                f"Maximum sampled interior clearance {clearance_mm:g} mm does not exceed "
                f"the sampling margin {margin_mm:g} mm. Use finer detail cells.")
    context.update({"distance": distances, "lattice": lattice, "envelope": envelope,
                    "thresholdMin": amplitude * (0.65 / 1.5), "thresholdMax": amplitude})
    return context


def prepare_quick_json(request_json):
    global _QUICK_CONTEXT
    try:
        _QUICK_CONTEXT = _prepare(json.loads(request_json))
        context = _QUICK_CONTEXT
        return json.dumps({"ok": True, "grid": {
            "resolution": context["resolution"], "envelope": context["envelope"].tolist(),
            "lattice": context["lattice"].tolist(), "sourceVolumeCells": context["source"].volume,
            "thresholdMin": context["thresholdMin"], "thresholdMax": context["thresholdMax"],
        }}, allow_nan=False)
    except QuickError as error:
        _QUICK_CONTEXT = None
        return json.dumps({"ok": False, "error": {"code": error.code, "message": str(error)}})


def _finish(candidate):
    context = _QUICK_CONTEXT
    _ensure(context is not None, "invalid-input", "Prepare a source before generating geometry.")
    request = context["request"]
    _ensure(isinstance(candidate, dict) and set(candidate) == {"vertices", "indices", "threshold"},
            "invalid-result", "The isosurface response is malformed.")
    vertices = np.asarray(candidate["vertices"], dtype=np.float64)
    indices = np.asarray(candidate["indices"])
    _ensure(vertices.ndim == 1 and 12 <= len(vertices) and len(vertices) % 3 == 0
            and np.all(np.isfinite(vertices)), "invalid-result", "The isosurface vertices are invalid.")
    _ensure(indices.ndim == 1 and 12 <= len(indices) and len(indices) % 3 == 0
            and np.issubdtype(indices.dtype, np.integer) and np.all(indices >= 0)
            and np.all(indices < len(vertices) // 3), "invalid-result", "The isosurface triangles are invalid.")
    mesh = trimesh.Trimesh(vertices.reshape(-1, 3), indices.reshape(-1, 3), process=False)
    mesh.merge_vertices(digits_vertex=7)
    mesh.remove_unreferenced_vertices()
    count, labels = _surface_components(mesh, "Generated mesh")
    # MarchingCubes has one global winding convention. Preserve relative shell
    # winding: nested negative shells are cavities, not disconnected solids.
    volumes = []
    for label in range(count):
        selected = labels == label
        volume = trimesh.triangles.mass_properties(mesh.triangles[selected])["volume"]
        _ensure(abs(volume) > 1e-7, "invalid-mesh", "The generated surface encloses a degenerate component.")
        volumes.append(volume)
    if volumes[int(np.argmax(np.abs(volumes)))] < 0:
        mesh.invert()
        volumes = [-volume for volume in volumes]
    mesh._cache.clear()
    threshold = _finite(candidate["threshold"], "lattice threshold", context["thresholdMin"], context["thresholdMax"])
    envelope = context["envelope"]
    lattice = context["lattice"]
    mode = request["mode"]
    material = ((context["distance"] > 0) & ((envelope <= 0) | (lattice <= threshold))
                if mode == "preserve-exterior" else (envelope > 0) & (lattice <= threshold))
    _, material_components = ndimage.label(material.reshape((context["resolution"],) * 3))
    _ensure(material_components == 1, "disconnected-mesh",
            "The requested lattice separates material at this resolution. Reduce removal or use finer detail cells.")
    # Validate the coordinates that binary STL actually stores. World-space float32
    # rounding must not be mistaken for a fixed fraction of the sampling detail.
    rounded_candidate = (mesh.vertices * context["cell"] + context["origin"]).astype(np.float32).astype(np.float64)
    rounded_candidate = (rounded_candidate - context["origin"]) / context["cell"]
    rounded_triangles = rounded_candidate[mesh.faces]
    rounded_centers = rounded_triangles.mean(axis=1)
    rounded_volumes = [trimesh.triangles.mass_properties(rounded_triangles[labels == label])["volume"]
                       for label in range(count)]
    _ensure(all(np.isfinite(rounded) and original * rounded > 0
                for original, rounded in zip(volumes, rounded_volumes)), "serialization-precision",
            "STL rounding inverted or collapsed a closed surface.")
    rounded_source_vertices = (context["source"].vertices * context["cell"] + context["origin"]).astype(np.float32).astype(np.float64)
    rounded_source = trimesh.Trimesh((rounded_source_vertices - context["origin"]) / context["cell"],
                                    context["source"].faces, process=False)
    rounded_source.merge_vertices(digits_vertex=10)
    rounded_source_count, _ = _surface_components(rounded_source, "Serialized source mesh")
    _ensure(rounded_source_count == 1 and rounded_source.is_volume, "serialization-precision",
            "STL rounding invalidated the captured source solid.")
    rounded_source._cache["triangles_tree"] = _SpatialTriangleIndex(rounded_source.triangles)
    required_distance = request["skinThicknessMm"] / context["cell"] if mode == "preserve-exterior" else 0
    logical_distance = _distances(context, np.vstack((mesh.vertices, mesh.triangles_center)))
    _ensure(np.all(logical_distance >= required_distance - 2e-5), "invalid-mesh",
            "The reconstructed surface leaves its conservative source envelope. Use finer detail cells.")
    checks = np.vstack((rounded_candidate, rounded_centers))
    distance = _distances({"source": rounded_source}, checks)
    _ensure(np.all(distance >= required_distance - 2e-5), "invalid-mesh",
            "The reconstructed surface leaves its conservative source envelope. Use finer detail cells.")
    if mode == "open-organic":
        _ensure(sum(volume > 0 for volume in volumes) == 1, "disconnected-mesh",
                "The generated organic mesh contains separate pieces. Reduce removal or use finer detail cells.")
        outer_label = next(label for label, volume in enumerate(volumes) if volume > 0)
        outer = trimesh.Trimesh(rounded_candidate, mesh.faces[labels == outer_label], process=False)
        outer.remove_unreferenced_vertices()
        outer._cache["triangles_tree"] = _SpatialTriangleIndex(outer.triangles)
        representatives = [rounded_centers[np.flatnonzero(labels == label)[0]]
                           for label in range(count) if label != outer_label]
        _ensure(not representatives or np.all(_contains(outer, np.asarray(representatives))), "invalid-mesh",
                "A generated cavity lies outside its material shell.")
        output_vertices = (mesh.vertices * context["cell"] + context["origin"]).ravel().tolist()
        output_indices = mesh.faces.ravel().tolist()
        result_volume = float(mesh.volume * context["cell"] ** 3)
    else:
        _ensure(all(volume > 0 for volume in volumes), "disconnected-mesh",
                "Internal voids enclose an isolated material island. Reduce removal or use finer detail cells.")
        output_vertices = request["mesh"]["vertices"] + (mesh.vertices * context["cell"] + context["origin"]).ravel().tolist()
        offset = len(request["mesh"]["vertices"]) // 3
        output_indices = request["mesh"]["indices"] + (mesh.faces[:, ::-1] + offset).ravel().tolist()
        result_volume = context["sourceVolume"] - float(mesh.volume * context["cell"] ** 3)
    # The ordinary STL import receives float32 coordinates. Check the actual
    # serialization, including vertex fans, before releasing double-precision metrics.
    output_array = np.asarray(output_vertices, dtype=np.float64).reshape(-1, 3)
    rounded_array = output_array.astype(np.float32).astype(np.float64)
    serialized = trimesh.Trimesh((rounded_array - context["origin"]) / context["cell"],
                                np.asarray(output_indices).reshape(-1, 3), process=False)
    serialized.merge_vertices(digits_vertex=10)
    _surface_components(serialized, "Serialized mesh")
    serialized_volume = float(serialized.volume)
    _ensure(0 < serialized_volume < rounded_source.volume, "serialization-precision",
            "The serialized result must retain positive material volume and positive removal.")
    removed = 100 * (1 - result_volume / context["sourceVolume"])
    _ensure(result_volume > 0 and 0 < removed < 100, "no-removable-material",
            "No positive-volume lightweighting result was found. Adjust removal, skin, or detail.")
    warnings = ["Load-free TPMS nodal geometry: stiffness, strength, and suitability for any load are not evaluated.",
                "The lattice cell size is independent of sampling detail. Features below the sampling size may be lost."]
    if mode == "preserve-exterior":
        warnings.append("The captured exterior triangles are preserved exactly; closed internal voids require a manufacturing process that can produce enclosed cavities.")
    else:
        warnings.append("The organic envelope is conservatively inset by one detail-cell diagonal; the original exterior is not retained.")
    if abs(removed - request["removalPercent"]) > 2:
        warnings.append(f"Requested {request['removalPercent']:g}% removal; measured {removed:.2f}%. Retained skin, source shape, and sampling limits constrain the result.")
    serialized_removed = 100 * (1 - serialized_volume / rounded_source.volume)
    if abs(serialized_removed - removed) > 2:
        warnings.append(f"Float32 STL removal is {serialized_removed:.2f}%; the logical mesh removal is {removed:.2f}%.")
    return {"schemaVersion": 1, "mode": mode, "requestedRemovalPercent": request["removalPercent"],
            "removedPercent": removed, "sourceVolumeMm3": context["sourceVolume"],
            "resultVolumeMm3": result_volume, "cellSizeMm": context["cell"],
            "skinThicknessMm": request["skinThicknessMm"], "cellType": context["cellType"],
            "latticeCellSizeMm": context["latticeCellSizeMm"],
            "warnings": warnings, "mesh": {"vertices": output_vertices, "indices": output_indices}}


def finish_quick_json(candidate_json):
    try:
        return json.dumps({"ok": True, "result": _finish(json.loads(candidate_json))}, allow_nan=False)
    except QuickError as error:
        return json.dumps({"ok": False, "error": {"code": error.code, "message": str(error)}})
