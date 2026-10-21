"""Reserve source-matched desktop versions and verify publication prerequisites."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
MANIFEST = "apps/desktop/package.json"
LOCK_VERSION = re.compile(
    r'("apps/desktop":\s*\{\s*"name":\s*"@vibeshape/desktop",\s*"version":\s*")([^"\n]+)(")'
)


def version_tuple(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError("Desktop versions must be stable MAJOR.MINOR.PATCH values.")
    return tuple(int(part) for part in value.split("."))


def next_version(minimum, tags):
    floor = version_tuple(minimum)
    used = [version_tuple(tag[9:]) for tag in tags
            if tag.startswith("desktop-v") and VERSION.fullmatch(tag[9:])]
    if used:
        major, minor, patch = max(used)
        floor = max(floor, (major, minor, patch + 1))
    return ".".join(map(str, floor))


def git(root, *args):
    return subprocess.run(
        ["git", "-c", "user.name=github-actions[bot]", "-c",
         "user.email=41898282+github-actions[bot]@users.noreply.github.com", *args],
        cwd=root, check=True, capture_output=True, text=True,
    ).stdout.strip()


def lock_version(text):
    matches = list(LOCK_VERSION.finditer(text))
    if len(matches) != 1:
        raise ValueError("Expected exactly one desktop workspace version in bun.lock.")
    return matches[0].group(2)


def version_files(manifest_text, lock, version):
    manifest = json.loads(manifest_text)
    if lock_version(lock) != manifest["version"]:
        raise ValueError("Desktop manifest and frozen lockfile versions disagree.")
    manifest["version"] = version
    return (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            LOCK_VERSION.sub(lambda match: match[1] + version + match[3], lock))


def verify_release_commit(root, tag, metadata, source, run_id):
    commit = git(root, "rev-parse", f"refs/tags/{tag}^{{commit}}")
    version = tag[9:]
    if (metadata != {"schemaVersion": 1, "runId": run_id,
                    "sourceCommit": source, "releaseCommit": commit}
            or git(root, "rev-list", "--parents", "-n", "1", commit).split() != [commit, source]
            or json.loads(git(root, "show", f"{commit}:{MANIFEST}"))["version"] != version
            or lock_version(git(root, "show", f"{commit}:bun.lock")) != version):
        raise ValueError("The reserved release no longer matches this run and source commit.")
    expected_manifest, expected_lock = version_files(
        git(root, "show", f"{source}:{MANIFEST}"), git(root, "show", f"{source}:bun.lock"), version)
    changes = git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines()
    if (not set(changes).issubset({MANIFEST, "bun.lock"})
            or git(root, "show", f"{commit}:{MANIFEST}") != expected_manifest.strip()
            or git(root, "show", f"{commit}:bun.lock") != expected_lock.strip()):
        raise ValueError("Release preparation may change only desktop version metadata.")
    return {"version": version, "tag": tag, "source-commit": commit}


def prepare_release(root, source, run_id, release_tags=()):
    root = Path(root)
    if not re.fullmatch(r"[a-f0-9]{40}", source) or not re.fullmatch(r"[0-9]+", run_id):
        raise ValueError("Release preparation requires an exact source SHA and numeric run ID.")
    if git(root, "status", "--porcelain") or git(root, "rev-parse", "HEAD") != source:
        raise ValueError("Release preparation requires a clean checkout of the dispatched source.")
    git(root, "fetch", "--tags", "origin")
    tags = git(root, "tag", "--list", "desktop-v*").splitlines()
    reservations = []
    for tag in tags:
        if not VERSION.fullmatch(tag[9:]) or git(root, "cat-file", "-t", f"refs/tags/{tag}") != "tag":
            continue
        annotation = git(root, "cat-file", "tag", f"refs/tags/{tag}").split("\n\n", 1)[1]
        try:
            metadata = json.loads(annotation)
        except json.JSONDecodeError:
            continue
        if isinstance(metadata, dict) and metadata.get("runId") == run_id:
            reservations.append(verify_release_commit(root, tag, metadata, source, run_id))
    if len(reservations) > 1:
        raise ValueError("Multiple release versions belong to this workflow run.")
    if reservations:
        return reservations[0]

    manifest_path = root / MANIFEST
    lock_path = root / "bun.lock"
    version = next_version(json.loads(manifest_path.read_text())["version"], [*tags, *release_tags])
    manifest, lock = version_files(manifest_path.read_text(), lock_path.read_text(), version)
    manifest_path.write_text(manifest)
    lock_path.write_text(lock)
    git(root, "add", "--", MANIFEST, "bun.lock")
    git(root, "commit", "--no-gpg-sign", "--allow-empty", "-m",
        f"chore(desktop): prepare {version} release\n\nSource-Commit: {source}\nRelease-Run: {run_id}")
    commit = git(root, "rev-parse", "HEAD")
    tag = f"desktop-v{version}"
    metadata = {"schemaVersion": 1, "runId": run_id,
                "sourceCommit": source, "releaseCommit": commit}
    git(root, "tag", "--no-sign", "-a", tag, "-m", json.dumps(metadata), commit)
    plan = verify_release_commit(root, tag, metadata, source, run_id)
    # Push only the new tag, never main; a conflicting remote tag fails without replacement.
    git(root, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
        "push", "origin", f"refs/tags/{tag}")
    return plan


def release_marker(run_id, source):
    return f"<!-- vibeshape-desktop-release:{run_id}:{source} -->"


def verify_draft(release, source, tag, tag_commit, run_id):
    if (release.get("draft") is not True or release.get("prerelease") is not False
            or release.get("tag_name") != tag or tag_commit != source
            or release_marker(run_id, source) not in (release.get("body") or "")):
        raise ValueError("Only this run's draft and exact source tag may receive release assets.")


def verify_publication(release, expected, source, tag, tag_commit, run_id, published):
    verify_draft(release, source, tag, tag_commit, run_id)
    assets = release["assets"]
    if (len(expected) != 6 or len(assets) != len(expected)
            or {asset["name"]: asset.get("digest") for asset in assets} != expected
            or any(asset.get("state") != "uploaded" or asset.get("size", 0) <= 0 for asset in assets)):
        raise ValueError("Draft source or assets changed after building; refuse publication.")
    current = version_tuple(tag[9:])
    for other in published:
        name = other.get("tag_name", "")
        if (not other.get("draft") and not other.get("prerelease") and other.get("published_at")
                and name.startswith("desktop-v") and VERSION.fullmatch(name[9:])
                and version_tuple(name[9:]) > current):
            raise ValueError("A newer desktop version is already public; refuse an outdated publication.")


def main():
    if sys.argv[1:] == ["prepare"]:
        pages = json.loads((Path(os.environ["RUNNER_TEMP"]) / "existing-releases.json").read_text())
        tags = [release["tag_name"] for page in pages for release in page]
        plan = prepare_release(Path.cwd(), os.environ["GITHUB_SHA"], os.environ["GITHUB_RUN_ID"], tags)
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for key, value in plan.items():
                output.write(f"{key}={value}\n")
        print(f"Reserved {plan['tag']} from {os.environ['GITHUB_SHA']} as {plan['source-commit']}.")
    elif sys.argv[1:] in (["stage"], ["verify"]):
        root = Path(os.environ["RUNNER_TEMP"])
        release = json.loads((root / "release.json").read_text())
        coordinates = (os.environ["SOURCE_COMMIT"], os.environ["RELEASE_TAG"],
                       os.environ["RELEASE_TAG_COMMIT"], os.environ["GITHUB_RUN_ID"])
        if sys.argv[1] == "stage":
            verify_draft(release, *coordinates)
        else:
            pages = json.loads((root / "published-releases.json").read_text())
            verify_publication(release, json.loads(os.environ["EXPECTED_DIGESTS"]), *coordinates,
                               [release for page in pages for release in page])
    else:
        raise ValueError("Usage: release.py prepare|stage|verify")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"Desktop release failed: {error}", file=sys.stderr)
        sys.exit(1)
