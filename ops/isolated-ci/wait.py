#!/usr/bin/env python3
"""Wait for a run-scoped result from the private, host-installed Mac broker."""

import argparse
from datetime import datetime, timezone
import json
import re
import subprocess
import sys
import time

REPOSITORY = "kolengri/VibeShape"
OWNER = "kolengri"


def report_progress(receipt):
    description = receipt.get("description")
    if not isinstance(description, str) or not re.fullmatch(r"Mac CI: [A-Za-z0-9 /().-]{1,110}", description):
        return None
    return description


def result_context(run_id, attempt, scope="node3"):
    if scope not in {"node3", "ci"}:
        raise ValueError("Invalid verification scope")
    return f"vibeshape/{'mac-ci' if scope == 'ci' else 'mac-node-3'}/{run_id}/{attempt}"


def result_receipt(statuses, run_id, attempt, scope="node3"):
    if not isinstance(statuses, list):
        raise ValueError("Invalid status response")
    context = result_context(run_id, attempt, scope)
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
        return status
    return None


def result_state(statuses, run_id, attempt):
    receipt = result_receipt(statuses, run_id, attempt)
    return receipt["state"] if receipt else "pending"


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


def wait_primary(sha, run_id, attempt, timeout=1800, unavailable_after=90,
                 fetch=statuses, now=time.monotonic, sleep=time.sleep):
    """Exit 75 only for absent/stalled infrastructure; verification failures fail CI."""
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Expected an exact source SHA")
    if type(run_id) is not int or type(attempt) is not int or min(run_id, attempt) < 1:
        raise ValueError("Expected positive run and attempt IDs")
    if not 1 <= unavailable_after <= timeout <= 1800:
        raise ValueError("Invalid result timeout")
    started = last_progress = now()
    last_id = None
    last_stage = None
    print("Waiting for isolated Mac CI to start.", flush=True)
    while now() - started < timeout:
        receipt = result_receipt(fetch(sha), run_id, attempt, "ci")
        if receipt:
            stage = report_progress(receipt)
            if stage is not None and stage != last_stage:
                timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
                print(f"[{timestamp}] {stage}", flush=True)
                last_stage = stage
            state = receipt["state"]
            if state == "success":
                print("Complete isolated Mac CI passed.")
                return 0
            if state == "failure":
                print("Isolated Mac verification failed.", file=sys.stderr)
                return 1
            if state == "error":
                print("Mac execution unavailable; run complete hosted CI.")
                return 75
            identity = receipt.get("id")
            if type(identity) is not int or identity <= 0:
                raise ValueError("Invalid heartbeat identity")
            if last_id is None or identity > last_id:
                last_id, last_progress = identity, now()
        if now() - last_progress >= unavailable_after:
            print("Mac did not start or stopped responding; run complete hosted CI.")
            return 75
        sleep(min(10, max(0, timeout - (now() - started))))
    print("Mac execution exceeded its deadline; run complete hosted CI.")
    return 75


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--attempt", type=int, required=True)
    parser.add_argument("--scope", choices=("node3", "ci"), default="node3")
    args = parser.parse_args()
    try:
        function = wait_primary if args.scope == "ci" else wait
        return function(args.sha, args.run_id, args.attempt)
    except (ValueError, RuntimeError, subprocess.TimeoutExpired):
        print("Isolated Mac result could not be verified.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
