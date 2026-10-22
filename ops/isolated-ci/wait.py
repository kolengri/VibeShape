#!/usr/bin/env python3
"""Wait for a run-scoped result from the private, host-installed Mac broker."""

import argparse
import json
import re
import subprocess
import sys
import time

REPOSITORY = "kolengri/VibeShape"
OWNER = "kolengri"


def result_context(run_id, attempt):
    return f"vibeshape/mac-node-3/{run_id}/{attempt}"


def result_state(statuses, run_id, attempt):
    if not isinstance(statuses, list):
        raise ValueError("Invalid status response")
    context = result_context(run_id, attempt)
    target = f"https://github.com/{REPOSITORY}/actions/runs/{run_id}"
    for status in statuses:
        if not isinstance(status, dict) or status.get("context") != context:
            continue
        if (not isinstance(status.get("creator"), dict)
                or status["creator"].get("login") != OWNER
                or status.get("target_url") != target):
            raise ValueError("Unexpected result identity")
        state = status.get("state")
        if state not in {"pending", "success", "failure", "error"}:
            raise ValueError("Invalid result state")
        return state
    return "pending"


def statuses(sha):
    response = subprocess.run(
        ["gh", "api", f"repos/{REPOSITORY}/commits/{sha}/statuses?per_page=100"],
        capture_output=True, text=True, timeout=30,
    )
    if response.returncode:
        # gh diagnostics may include credential-bearing response data.
        raise RuntimeError("Unable to read the isolated Mac result")
    return json.loads(response.stdout)


def wait(sha, run_id, attempt, timeout=1200, fetch=statuses,
         now=time.monotonic, sleep=time.sleep):
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Expected an exact source SHA")
    if type(run_id) is not int or type(attempt) is not int or min(run_id, attempt) < 1:
        raise ValueError("Expected positive run and attempt IDs")
    if not 1 <= timeout <= 1500:
        raise ValueError("Invalid result timeout")
    started = now()
    while now() - started < timeout:
        state = result_state(fetch(sha), run_id, attempt)
        if state == "success":
            print("Isolated Mac node shard passed.")
            return 0
        if state in {"failure", "error"}:
            print("Isolated Mac node shard failed.", file=sys.stderr)
            return 1
        sleep(min(10 if now() - started < 120 else 30,
                  max(0, timeout - (now() - started))))
    print("Timed out waiting for the isolated Mac node shard.", file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--attempt", type=int, required=True)
    args = parser.parse_args()
    try:
        return wait(args.sha, args.run_id, args.attempt)
    except (ValueError, RuntimeError, subprocess.TimeoutExpired):
        print("Isolated Mac result could not be verified.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
