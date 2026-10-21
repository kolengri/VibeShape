import copy
import json
import os
import subprocess
import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import patch

from release import git, next_version, prepare_release, verify_draft, verify_publication


class VersionTests(unittest.TestCase):
    def test_automatically_increments_the_highest_reserved_stable_version(self):
        self.assertEqual(next_version("0.1.13", ["desktop-v0.1.13"]), "0.1.14")
        self.assertEqual(next_version("0.1.13", ["desktop-v0.1.9", "desktop-v0.1.14"]), "0.1.15")
        self.assertEqual(next_version("0.1.13", ["desktop-v1.2.99"]), "1.2.100")

    def test_unreleased_source_version_is_a_minimum_without_changing_its_series(self):
        self.assertEqual(next_version("0.2.0", ["desktop-v0.1.14"]), "0.2.0")
        self.assertEqual(next_version("0.1.14", ["desktop-v0.1.13"]), "0.1.14")
        self.assertEqual(next_version("0.1.0", []), "0.1.0")

    def test_ignores_other_release_channels_and_prerelease_tags(self):
        self.assertEqual(next_version("0.1.13", ["occt-v99.0.0", "desktop-v9.0.0-preview",
                                                "desktop-v01.0.0", "desktop-v0.1.13"]), "0.1.14")
        for value in ("0.1.14-beta", "v0.1.14", "01.2.3", "1.2", "1.2.3\n"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                next_version(value, [])


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="vibeshape-release-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.work = self.root / "work"
        subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(self.remote)],
                       check=True, capture_output=True)
        subprocess.run(["git", "clone", str(self.remote), str(self.work)],
                       check=True, capture_output=True)
        (self.work / "apps/desktop").mkdir(parents=True)
        self.manifest = {"name": "@vibeshape/desktop", "version": "0.1.13", "license": "GPL-3.0-or-later"}
        (self.work / "apps/desktop/package.json").write_text(json.dumps(self.manifest, indent=2) + "\n")
        (self.work / "bun.lock").write_text('''{
  "lockfileVersion": 1,
  "workspaces": {
    "apps/desktop": {
      "name": "@vibeshape/desktop",
      "version": "0.1.13",
      "dependencies": {"electron": "44.9.0"},
    },
  },
}
''')
        (self.work / "runtime.js").write_text("// Runtime source must remain unchanged.\n")
        git(self.work, "add", ".")
        git(self.work, "commit", "--no-gpg-sign", "-m", "Initial application")
        git(self.work, "push", "origin", "main")
        self.source = git(self.work, "rev-parse", "HEAD")
        git(self.work, "tag", "desktop-v0.1.13")
        git(self.work, "push", "origin", "refs/tags/desktop-v0.1.13")

    def clone(self, name):
        path = self.root / name
        subprocess.run(["git", "clone", str(self.remote), str(path)], check=True, capture_output=True)
        return path

    def test_reserves_new_version_with_exact_sources_without_pushing_main(self):
        plan = prepare_release(self.work, self.source, "123")
        self.assertEqual(plan["version"], "0.1.14")
        self.assertEqual(plan["tag"], "desktop-v0.1.14")
        commit = plan["source-commit"]
        self.assertNotEqual(commit, self.source)
        self.assertEqual(git(self.remote, "rev-parse", "main"), self.source)
        self.assertEqual(git(self.remote, "rev-parse", "desktop-v0.1.14^{commit}"), commit)
        self.assertEqual(git(self.work, "rev-parse", f"{commit}^"), self.source)
        self.assertEqual(set(git(self.work, "diff-tree", "--no-commit-id", "--name-only", "-r", commit)
                             .splitlines()), {"apps/desktop/package.json", "bun.lock"})
        self.assertEqual(json.loads(git(self.remote, "show", f"{commit}:apps/desktop/package.json")),
                         {**self.manifest, "version": "0.1.14"})
        lock = git(self.remote, "show", f"{commit}:bun.lock")
        self.assertIn('"version": "0.1.14"', lock)
        self.assertIn('"electron": "44.9.0"', lock)
        self.assertEqual(git(self.work, "status", "--porcelain"), "")

    def test_same_run_reuses_its_tag_after_later_runs_reserve_other_versions(self):
        first = prepare_release(self.work, self.source, "123")
        second = prepare_release(self.clone("second"), self.source, "124")
        retry = prepare_release(self.clone("retry"), self.source, "123")
        self.assertEqual(second["version"], "0.1.15")
        self.assertEqual(retry, first)
        self.assertEqual(git(self.remote, "rev-parse", "main"), self.source)

    def test_untagged_github_drafts_also_reserve_their_version(self):
        plan = prepare_release(self.work, self.source, "123", ["desktop-v0.1.14"])
        self.assertEqual(plan["version"], "0.1.15")

    def test_cli_emits_pinned_outputs_and_resumes_from_shallow_checkouts(self):
        fixture = self.root / "existing-releases.json"
        fixture.write_text(json.dumps([[{"tag_name": "desktop-v0.1.13"}]]))
        outputs = []
        for name in ("first-shallow", "retry-shallow"):
            work = self.root / name
            subprocess.run(["git", "clone", "--depth=1", "--branch=main", self.remote.as_uri(), str(work)],
                           check=True, capture_output=True)
            output = self.root / f"{name}.txt"
            env = {**os.environ, "GITHUB_SHA": self.source, "GITHUB_RUN_ID": "123",
                   "RUNNER_TEMP": str(self.root), "GITHUB_OUTPUT": str(output)}
            subprocess.run([sys.executable, str(Path(__file__).with_name("release.py")), "prepare"],
                           cwd=work, env=env, check=True, capture_output=True)
            outputs.append(dict(line.split("=", 1) for line in output.read_text().splitlines()))
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[0]["version"], "0.1.14")
        self.assertEqual(outputs[0]["tag"], "desktop-v0.1.14")
        self.assertEqual(git(self.remote, "rev-parse", "desktop-v0.1.14^{commit}"),
                         outputs[0]["source-commit"])
        self.assertEqual(git(self.remote, "rev-parse", "main"), self.source)

    def test_rejects_dirty_checkout_and_wrong_source_before_reserving(self):
        (self.work / "uncommitted.txt").write_text("unrelated work")
        with self.assertRaisesRegex(ValueError, "clean checkout"):
            prepare_release(self.work, self.source, "123")
        (self.work / "uncommitted.txt").unlink()
        with self.assertRaisesRegex(ValueError, "clean checkout"):
            prepare_release(self.work, "a" * 40, "123")
        for value in ("", "bad\nvalue", "../run"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                prepare_release(self.work, self.source, value)
        self.assertEqual(git(self.remote, "tag", "--list"), "desktop-v0.1.13")

    def test_rejects_lock_version_disagreement(self):
        path = self.work / "bun.lock"
        path.write_text(path.read_text().replace('"version": "0.1.13"', '"version": "0.1.12"'))
        git(self.work, "add", "bun.lock")
        git(self.work, "commit", "--no-gpg-sign", "-m", "Mismatched lockfile")
        with self.assertRaisesRegex(ValueError, "versions disagree"):
            prepare_release(self.work, git(self.work, "rev-parse", "HEAD"), "123")

    def test_failed_remote_push_cannot_replace_an_existing_tag(self):
        original_git = git

        def conflict(root, *args):
            if "push" in args:
                original_git(self.remote, "tag", "desktop-v0.1.14", self.source)
            return original_git(root, *args)

        with patch("release.git", side_effect=conflict), self.assertRaises(subprocess.CalledProcessError):
            prepare_release(self.work, self.source, "123")
        self.assertEqual(git(self.remote, "rev-parse", "desktop-v0.1.14"), self.source)
        self.assertEqual(git(self.remote, "rev-parse", "main"), self.source)

    def test_resumed_reservation_cannot_include_runtime_changes(self):
        plan = prepare_release(self.work, self.source, "123")
        git(self.work, "reset", "--soft", self.source)
        (self.work / "runtime.js").write_text("// Unexpected runtime change.\n")
        git(self.work, "add", ".")
        git(self.work, "commit", "--no-gpg-sign", "-m", "Altered release source")
        commit = git(self.work, "rev-parse", "HEAD")
        metadata = {"schemaVersion": 1, "runId": "123", "sourceCommit": self.source, "releaseCommit": commit}
        git(self.work, "tag", "--no-sign", "-f", "-a", plan["tag"], "-m", json.dumps(metadata))
        git(self.work, "push", "--force", "origin", f"refs/tags/{plan['tag']}")
        with self.assertRaisesRegex(ValueError, "only desktop version metadata"):
            prepare_release(self.clone("retry"), self.source, "123")


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.source = "a" * 40
        names = ["VibeShape-0.1.14-mac-arm64.dmg", "desktop-build.json", "SHA256SUMS",
                 "VibeShape-0.1.14-win-x64.zip", "desktop-build-win-x64.json", "SHA256SUMS-win-x64"]
        self.digests = {name: "sha256:" + str(index) * 64 for index, name in enumerate(names)}
        self.release = {"draft": True, "prerelease": False, "tag_name": "desktop-v0.1.14",
                        "target_commitish": self.source,
                        "body": "<!-- vibeshape-desktop-release:123:" + self.source + " -->\nSource notes",
                        "assets": [{"name": name, "state": "uploaded", "size": 42, "digest": digest}
                                   for name, digest in self.digests.items()]}

    def verify(self, release=None, published=None, tag_commit=None):
        verify_publication(self.release if release is None else release, self.digests,
                           self.source, "desktop-v0.1.14",
                           self.source if tag_commit is None else tag_commit, "123", published or [])

    def test_accepts_only_the_exact_accepted_asset_set(self):
        self.verify()
        for field, value in (("digest", "sha256:" + "f" * 64), ("state", "new"), ("size", 0)):
            changed = copy.deepcopy(self.release)
            changed["assets"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(changed)
        for assets in (self.release["assets"][:-1], self.release["assets"] + [self.release["assets"][0]]):
            with self.subTest(assets=assets), self.assertRaises(ValueError):
                self.verify({**self.release, "assets": assets})

    def test_refuses_public_or_different_source_releases(self):
        for field, value in (("draft", False), ("prerelease", True),
                             ("tag_name", "desktop-v0.1.15")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify({**self.release, field: value})
        for value in ("", "b" * 40):
            with self.subTest(tag_commit=value), self.assertRaises(ValueError):
                self.verify(tag_commit=value)

    def test_existing_tags_use_resolved_source_instead_of_creation_target(self):
        self.verify({**self.release, "target_commitish": "main"})

    def test_staging_refuses_foreign_drafts_and_public_releases_before_upload(self):
        verify_draft(self.release, self.source, "desktop-v0.1.14", self.source, "123")
        for change in ({"draft": False}, {"prerelease": True}, {"body": "Manually created draft"},
                       {"body": "<!-- vibeshape-desktop-release:124:" + self.source + " -->"}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "this run's draft"):
                verify_draft({**self.release, **change}, self.source, "desktop-v0.1.14", self.source, "123")

    def test_late_retry_cannot_supersede_a_newer_public_version(self):
        other = {"tag_name": "desktop-v0.1.15", "draft": False, "prerelease": False,
                 "published_at": "2026-10-21T00:00:00Z"}
        with self.assertRaisesRegex(ValueError, "newer desktop version"):
            self.verify(published=[other])
        for change in ({"draft": True}, {"prerelease": True}, {"published_at": None},
                       {"tag_name": "desktop-v0.1.13"}, {"tag_name": "occt-v9.0.0"}):
            with self.subTest(change=change):
                self.verify(published=[{**other, **change}])


if __name__ == "__main__":
    unittest.main()
