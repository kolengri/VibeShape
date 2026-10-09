#!/usr/bin/env python3
"""Check production prerequisites before running deployment verification."""

import json
import os
import re
import subprocess
import sys


def check_preflight(environment, read_api):
    repository = environment.get("GITHUB_REPOSITORY", "")
    source = environment.get("GITHUB_SHA", "")
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", repository)
            or environment.get("GITHUB_REF") != "refs/heads/main"
            or not re.fullmatch(r"[a-f0-9]{40}", source)):
        raise ValueError("Production verification requires an exact main commit.")
    asset = environment.get("KERNEL_ASSET_ID", "")
    if not re.fullmatch(r"[0-9]+", asset):
        raise ValueError("Configure VIBESHAPE_OCCT_RELEASE_ASSET_ID.")
    branch = read_api(f"repos/{repository}/branches/main")
    if branch.get("commit", {}).get("sha") != source:
        raise ValueError("The production source is no longer the current main commit.")
    metadata = read_api(f"repos/{repository}/releases/assets/{asset}")
    if metadata.get("id") != int(asset) or type(metadata.get("size")) is not int or metadata["size"] <= 0:
        raise ValueError("The configured kernel release asset is unavailable or empty.")


def read_github(path):
    result = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise RuntimeError("Unable to read production prerequisites from GitHub.")
    return json.loads(result.stdout)


def main():
    try:
        check_preflight(os.environ, read_github)
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        # API output and command environments can contain credentials; never echo them.
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "Production preflight could not complete."
        print(message, file=sys.stderr)
        return 1
    print("Production prerequisites passed; artifact and publication checks remain required.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
