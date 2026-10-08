#!/usr/bin/env python3
"""Recover current, trusted workflows blocked by GitHub Actions billing limits."""

import argparse
import base64
import datetime as dt
import fcntl
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote

VARIABLE = "VIBESHAPE_CI_RUNNER"
WORKFLOWS = {".github/workflows/ci.yml", ".github/workflows/cloudflare-pages.yml"}


def billing_blocked(job, annotations):
    # A test/build failure must never switch routing or trigger an automatic retry.
    if job.get("conclusion") != "failure" or job.get("steps"):
        return False
    return any(
        item.get("annotation_level") == "failure"
        and "the job was not started" in item.get("message", "").lower()
        and any(text in item.get("message", "").lower()
                for text in ("spending limit", "included minutes", "minutes limit"))
        for item in annotations
    )


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if result.returncode:
        # Do not print command arguments or credential-bearing subprocess output.
        raise RuntimeError(f"{Path(args[0]).name} operation failed (exit {result.returncode})")
    return result.stdout


class GitHub:
    def __init__(self, executable, repository):
        self.executable = executable
        self.prefix = f"repos/{repository}"

    def api(self, suffix, method="GET", payload=None):
        args = [self.executable, "api", f"{self.prefix}/{suffix}", "--method", method]
        for key, value in (payload or {}).items():
            args.extend(["-f", f"{key}={value}"])
        output = command(args)
        return json.loads(output) if output.strip() else None

    def mode(self):
        variables = self.api("actions/variables?per_page=100")["variables"]
        return next((v["value"] for v in variables if v["name"] == VARIABLE), "github")

    def set_mode(self, mode):
        self.api(f"actions/variables/{VARIABLE}", "PATCH", {"value": mode})

    def current_trusted(self, run, owner, repository):
        if run["event"] == "pull_request":
            pulls = run.get("pull_requests", [])
            if not pulls:
                pulls = self.api(f"pulls?state=open&head={quote(owner + ':' + run['head_branch'], safe='')}")
            for pull in pulls:
                pr = self.api(f"pulls/{pull['number']}")
                if (pr["state"] == "open" and pr["user"]["login"] == owner
                        and pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == repository
                        and pr["head"]["sha"] == run["head_sha"]):
                    return True
            return False
        if run["event"] not in {"push", "workflow_dispatch"} or run["head_branch"] != "main":
            return False
        branch = self.api("branches/main")
        return branch["commit"]["sha"] == run["head_sha"]

    def supports_routing(self, run):
        # For PRs this is the branch head, not the original synthetic merge commit.
        # Require rollout on the source branch rather than guessing a newer merge ref.
        paths = {run["path"], ".github/workflows/ci.yml"}
        for path in paths:
            data = self.api(f"contents/{path}?ref={run['head_sha']}")
            source = base64.b64decode(data["content"]).decode()
            if VARIABLE not in source:
                return False
        return True


def save_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def poll(gh, state, now, repository, runner, dry_run=False):
    state.setdefault("retried_runs", [])
    month = now.strftime("%Y-%m")
    mode = gh.mode()
    if state.get("fallback_month") and state["fallback_month"] != month:
        if mode == "mac":
            print("New UTC billing month: restore GitHub-hosted routing.")
            if not dry_run:
                gh.set_mode("github")
                mode = "github"
        if not dry_run:
            state.pop("fallback_month", None)
            state["since"] = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
            state["handled"] = []
            state["retried_runs"] = []

    online = any(r["name"] == runner and r["status"] == "online"
                 for r in gh.api("actions/runners?per_page=100")["runners"])
    if not online:
        print("Local runner is offline; routing and runs remain unchanged.")
        return

    owner = repository.split("/")[0]
    since = dt.datetime.fromisoformat(state["since"])
    runs = gh.api("actions/runs?status=failure&per_page=100")["workflow_runs"]
    for run in reversed(runs):
        key = f"{run['id']}:{run['run_attempt']}"
        if (key in state["handled"] or str(run["id"]) in state["retried_runs"] or run["path"] not in WORKFLOWS
                or dt.datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")) < since):
            continue
        if not gh.current_trusted(run, owner, repository) or not gh.supports_routing(run):
            state["handled"].append(key)
            continue
        jobs = gh.api(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs?per_page=100")["jobs"]
        blocked = False
        for job in jobs:
            if job.get("conclusion") != "failure" or job.get("steps"):
                continue
            check_id = job["check_run_url"].rsplit("/", 1)[-1]
            annotations = gh.api(f"check-runs/{check_id}/annotations?per_page=100")
            blocked = blocked or billing_blocked(job, annotations)
        if not blocked:
            # Retry inspection briefly if GitHub has not published the check yet.
            completed = dt.datetime.fromisoformat(run["updated_at"].replace("Z", "+00:00"))
            if now - completed > dt.timedelta(minutes=10):
                state["handled"].append(key)
            continue
        print(f"Billing-blocked run {run['id']}: route to Mac and retry failed jobs.")
        if dry_run:
            continue
        if mode != "mac":
            # Persist intent even when GitHub applied PATCH but its response was lost.
            state["fallback_month"] = month
            gh.set_mode("mac")
            mode = "mac"
        gh.api(f"actions/runs/{run['id']}/rerun-failed-jobs", "POST")
        state["retried_runs"].append(str(run["id"]))
        state["handled"].append(key)
    state["handled"] = state["handled"][-500:]
    state["retried_runs"] = state["retried_runs"][-500:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default="kolengri/VibeShape")
    parser.add_argument("--runner", default="vibeshape-mac")
    parser.add_argument("--container", default="vibeshape-actions-runner")
    parser.add_argument("--gh", default="gh")
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        parser.error("Expected an owner/repository name.")
    args.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with args.state.with_suffix(".lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        now = dt.datetime.now(dt.timezone.utc)
        state = json.loads(args.state.read_text()) if args.state.exists() else {
            "since": now.isoformat(), "handled": []
        }
        try:
            running = command([args.docker, "inspect", "--format", "{{.State.Running}}", args.container]).strip()
            if running != "true" and not args.dry_run:
                command([args.docker, "start", args.container])
            poll(GitHub(args.gh, args.repository), state, now, args.repository, args.runner, args.dry_run)
        finally:
            if not args.dry_run:
                save_state(args.state, state)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
