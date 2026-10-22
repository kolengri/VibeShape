"""Exercise draft metadata lookup in the actual workflow shell steps."""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def workflow_step(name):
    lines = (ROOT / ".github/workflows/desktop-release.yml").read_text().splitlines()
    start = lines.index(f"      - name: {name}") + 1
    while lines[start] != "        run: |":
        start += 1
    body = []
    for line in lines[start + 1:]:
        if line and not line.startswith("          "):
            break
        body.append(line)
    return textwrap.dedent("\n".join(body))


class DraftMetadataWorkflowTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="vibeshape-draft-workflow-")
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        self.bin = self.work / "bin"
        self.bin.mkdir()
        helper = self.work / "ops/desktop-release/release.py"
        helper.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "ops/desktop-release/release.py", helper)
        source = "a" * 40
        names = ["VibeShape-0.1.14-mac-arm64.dmg", "desktop-build.json", "SHA256SUMS",
                 "VibeShape-0.1.14-win-x64.zip", "desktop-build-win-x64.json", "SHA256SUMS-win-x64"]
        digests = {name: "sha256:" + hashlib.sha256(name.encode()).hexdigest() for name in names}
        release = {"id": 42, "tag_name": "desktop-v0.1.14", "draft": True, "prerelease": False,
                   "body": f"<!-- vibeshape-desktop-release:123:{source} -->",
                   "assets": [{"name": name, "digest": digest, "state": "uploaded", "size": 42}
                              for name, digest in digests.items()]}
        (self.work / "fixture-release.json").write_text(json.dumps(release))
        self.env = {**os.environ, "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
                    "RUNNER_TEMP": str(self.work), "GITHUB_REPOSITORY": "kolengri/VibeShape",
                    "GITHUB_RUN_ID": "123", "SOURCE_COMMIT": source, "RELEASE_TAG": "desktop-v0.1.14",
                    "RELEASE_VERSION": "0.1.14", "EXPECTED_DIGESTS": json.dumps(digests)}
        self.command("gh", '''
import json
import os
import sys
from pathlib import Path
root = Path(os.environ["RUNNER_TEMP"])
args = sys.argv[1:]
with (root / "calls.jsonl").open("a") as calls:
    calls.write(json.dumps(args) + "\\n")
if args[:2] == ["release", "view"]:
    if "--json" in args:
        if os.environ.get("LOOKUP_FAIL"):
            sys.exit(29)
        if args[args.index("--json") + 1] != "apiUrl":
            sys.exit(2)
        print("https://api.github.com/repos/kolengri/VibeShape/releases/42")
elif args and args[0] == "api":
    if any("/releases/tags/" in arg for arg in args):
        print("gh: Not Found (HTTP 404)", file=sys.stderr)
        sys.exit(1)
    if "https://api.github.com/repos/kolengri/VibeShape/releases/42" in args:
        if os.environ.get("METADATA_FAIL"):
            sys.exit(31)
        print((root / "fixture-release.json").read_text())
    elif "--paginate" in args:
        print("[[]]")
    else:
        sys.exit(2)
elif args[:2] != ["release", "upload"]:
    sys.exit(2)
''')
        self.command("git", '''
import os
print("b" * 40 + "\\trefs/tags/desktop-v0.1.14")
print(os.environ["SOURCE_COMMIT"] + "\\trefs/tags/desktop-v0.1.14^{}")
''')

    def command(self, name, script):
        path = self.bin / name
        path.write_text("#!/usr/bin/env python3\n" + textwrap.dedent(script))
        path.chmod(0o755)

    def run_step(self, name, **extra_env):
        result = subprocess.run(["bash", "-e", "-c", workflow_step(name)], cwd=self.work,
                                env={**self.env, **extra_env}, capture_output=True, text=True)
        calls = [json.loads(line) for line in (self.work / "calls.jsonl").read_text().splitlines()]
        return result, calls

    def test_staging_reads_draft_by_api_id_and_reaches_asset_upload(self):
        result, calls = self.run_step("Stage the draft release")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum(call[:2] == ["release", "upload"] for call in calls), 1)

    def test_publication_guard_can_read_the_still_unpublished_draft(self):
        result, _ = self.run_step("Verify the draft still contains exactly the accepted assets")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_failed_release_resolution_stops_before_upload(self):
        result, calls = self.run_step("Stage the draft release", LOOKUP_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ["release", "upload"] for call in calls))

    def test_failed_metadata_request_stops_before_upload(self):
        result, calls = self.run_step("Stage the draft release", METADATA_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ["release", "upload"] for call in calls))


if __name__ == "__main__":
    unittest.main()
