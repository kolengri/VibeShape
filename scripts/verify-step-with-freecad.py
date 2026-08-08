import hashlib
import json
import math
import os
import sys

import FreeCAD
import Part


MAXIMUM_RELATIVE_VOLUME_ERROR = 1e-8
MAXIMUM_BOUNDS_DELTA_MM = 1e-5


def require_environment(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def read_json(path):
    with open(path, "r", encoding="utf-8") as input_file:
        return json.load(input_file)


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as output_file:
        json.dump(value, output_file, indent=2, sort_keys=True)
        output_file.write("\n")


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def vector_from_bounds(bounds, prefix):
    return [
        float(getattr(bounds, f"{axis}{prefix}"))
        for axis in ("X", "Y", "Z")
    ]


def maximum_bounds_delta(actual, expected):
    return max(
        abs(actual[side][index] - expected[side][index])
        for side in ("min", "max")
        for index in range(3)
    )


def require_finite_metrics(metrics):
    values = [
        metrics["volume"],
        metrics["surfaceArea"],
        *metrics["bounds"]["min"],
        *metrics["bounds"]["max"],
    ]
    if not all(math.isfinite(value) for value in values):
        raise RuntimeError("FreeCAD produced non-finite STEP metrics.")


def freecad_version():
    return ".".join(str(value) for value in FreeCAD.Version()[:3])


def validate_step(step_path, producer_report):
    shape = Part.Shape()
    shape.read(step_path)

    if shape.isNull():
        raise RuntimeError("FreeCAD imported a null STEP shape.")

    bounds = shape.BoundBox
    metrics = {
        "valid": bool(shape.isValid()),
        "volume": float(shape.Volume),
        "surfaceArea": float(shape.Area),
        "bounds": {
            "min": vector_from_bounds(bounds, "Min"),
            "max": vector_from_bounds(bounds, "Max"),
        },
        "faceCount": len(shape.Faces),
        "edgeCount": len(shape.Edges),
        "solidCount": len(shape.Solids),
        "shapeType": str(shape.ShapeType),
    }
    require_finite_metrics(metrics)

    expected_shape = producer_report["shape"]
    relative_volume_error = abs(metrics["volume"] - expected_shape["volume"]) / max(
        abs(expected_shape["volume"]), 1e-12
    )
    bounds_delta = maximum_bounds_delta(metrics["bounds"], expected_shape["bounds"])

    if not metrics["valid"]:
        raise RuntimeError("FreeCAD reports that the imported STEP shape is invalid.")
    if metrics["solidCount"] != 1:
        raise RuntimeError("FreeCAD did not import exactly one solid from the STEP fixture.")
    if metrics["volume"] <= 0:
        raise RuntimeError("FreeCAD imported a non-positive STEP volume.")
    if relative_volume_error > MAXIMUM_RELATIVE_VOLUME_ERROR:
        raise RuntimeError("FreeCAD STEP volume differs from the producer beyond tolerance.")
    if bounds_delta > MAXIMUM_BOUNDS_DELTA_MM:
        raise RuntimeError("FreeCAD STEP bounds differ from the producer beyond tolerance.")

    return metrics, relative_volume_error, bounds_delta


def main():
    step_path = require_environment("VIBESHAPE_STEP_INPUT")
    producer_report_path = require_environment("VIBESHAPE_STEP_PRODUCER_REPORT")
    output_path = require_environment("VIBESHAPE_STEP_FREECAD_REPORT")
    producer_report = read_json(producer_report_path)
    input_bytes = os.path.getsize(step_path)
    input_sha256 = sha256(step_path)

    if input_bytes != producer_report["step"]["bytes"]:
        raise RuntimeError("STEP fixture byte length does not match the producer report.")
    if input_sha256 != producer_report["step"]["sha256"]:
        raise RuntimeError("STEP fixture digest does not match the producer report.")

    metrics, relative_volume_error, bounds_delta = validate_step(step_path, producer_report)
    report = {
        "schemaVersion": 1,
        "reader": {
            "name": "FreeCAD",
            "version": freecad_version(),
            "implementation": "Part.Shape.read",
        },
        "input": {
            "file": os.path.basename(step_path),
            "bytes": input_bytes,
            "sha256": input_sha256,
        },
        "shape": metrics,
        "comparison": {
            "relativeVolumeError": relative_volume_error,
            "maxBoundsDeltaMm": bounds_delta,
        },
        "tolerances": {
            "maximumRelativeVolumeError": MAXIMUM_RELATIVE_VOLUME_ERROR,
            "maximumBoundsDeltaMm": MAXIMUM_BOUNDS_DELTA_MM,
        },
        "passed": True,
    }
    write_json(output_path, report)
    print(f"FreeCAD validated STEP fixture: {output_path}")


try:
    main()
except Exception as error:
    print(f"FreeCAD STEP validation failed: {error}", file=sys.stderr)
    raise

