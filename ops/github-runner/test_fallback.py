import base64
import datetime as dt
import unittest

from fallback import VARIABLE, billing_blocked, poll

NOW = dt.datetime(2026, 10, 8, 16, 0, tzinfo=dt.timezone.utc)
MESSAGE = "The job was not started because your spending limit needs to be increased."


class FakeGitHub:
    def __init__(self):
        self.routing = "github"
        self.online = True
        self.trusted = True
        self.supported = True
        self.mutations = []
        self.runs = [{"id": 12, "run_attempt": 1, "path": ".github/workflows/ci.yml",
                      "event": "pull_request", "head_sha": "abc", "head_branch": "feature",
                      "created_at": "2026-10-08T15:40:00Z", "updated_at": "2026-10-08T15:55:00Z"}]
        self.jobs = [{"conclusion": "failure", "steps": [], "check_run_url": "https://api.github.com/check-runs/23"}]
        self.annotations = [{"annotation_level": "failure", "message": MESSAGE}]

    def mode(self):
        return self.routing

    def set_mode(self, mode):
        self.routing = mode
        self.mutations.append(("routing", mode))

    def current_trusted(self, *args):
        return self.trusted

    def supports_routing(self, *args):
        return self.supported

    def api(self, suffix, method="GET", payload=None):
        if suffix.startswith("actions/runners?"):
            return {"runners": [{"name": "vibeshape-mac", "status": "online" if self.online else "offline"}]}
        if suffix.startswith("actions/runs?"):
            return {"workflow_runs": self.runs}
        if "/jobs?" in suffix:
            return {"jobs": self.jobs}
        if suffix.startswith("check-runs/"):
            return self.annotations
        if suffix.endswith("rerun-failed-jobs"):
            self.mutations.append(("rerun", suffix))
            return None
        raise AssertionError(suffix)


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.gh = FakeGitHub()
        self.state = {"since": "2026-10-08T15:30:00+00:00", "handled": []}

    def poll(self, now=NOW, dry_run=False):
        poll(self.gh, self.state, now, "kolengri/VibeShape", "vibeshape-mac", dry_run)

    def test_billing_block_switches_and_retries_once(self):
        self.poll()
        self.poll()
        self.gh.runs[0]["run_attempt"] = 2
        self.poll()
        self.assertEqual(self.gh.mutations, [("routing", "mac"), ("rerun", "actions/runs/12/rerun-failed-jobs")])
        self.assertEqual(self.state["fallback_month"], "2026-10")

    def test_failed_test_never_switches_even_with_billing_text(self):
        self.gh.jobs[0]["steps"] = [{"name": "Test", "conclusion": "failure"}]
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_manual_retry_after_test_failure_can_recover_billing_block(self):
        self.gh.runs[0]["updated_at"] = "2026-10-08T15:40:00Z"
        self.gh.jobs[0]["steps"] = [{"name": "Test", "conclusion": "failure"}]
        self.poll()
        self.assertEqual(self.state["handled"], ["12:1"])
        self.gh.runs[0]["run_attempt"] = 2
        self.gh.jobs[0]["steps"] = []
        self.poll()
        self.assertEqual(self.gh.mutations, [("routing", "mac"),
                                            ("rerun", "actions/runs/12/rerun-failed-jobs")])

    def test_other_scheduling_failure_is_ignored(self):
        self.gh.annotations[0]["message"] = "The job was not started because the runner is unavailable."
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_offline_runner_never_redirects(self):
        self.gh.online = False
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_stale_or_untrusted_revision_never_retries(self):
        self.gh.trusted = False
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_legacy_workflow_never_retries(self):
        self.gh.supported = False
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_runs_before_installation_are_ignored(self):
        self.state["since"] = "2026-10-08T15:50:00+00:00"
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_new_month_restores_only_automatic_override(self):
        self.gh.routing = "mac"
        self.state["fallback_month"] = "2026-09"
        self.gh.runs = []
        self.poll()
        self.assertEqual(self.gh.mutations, [("routing", "github")])
        self.assertNotIn("fallback_month", self.state)

    def test_new_month_still_recovers_new_month_billing_failures(self):
        self.gh.routing = "mac"
        self.state["fallback_month"] = "2026-09"
        self.poll()
        self.assertEqual(self.gh.mutations, [("routing", "github"), ("routing", "mac"),
                                            ("rerun", "actions/runs/12/rerun-failed-jobs")])

    def test_manual_mac_selection_survives_month_change(self):
        self.gh.routing = "mac"
        self.gh.runs = []
        self.poll()
        self.assertEqual(self.gh.mutations, [])

    def test_dry_run_does_not_mutate_github(self):
        self.poll(dry_run=True)
        self.assertEqual(self.gh.mutations, [])

    def test_retry_api_failure_remains_retryable(self):
        original_api = self.gh.api

        def failing_api(suffix, method="GET", payload=None):
            if suffix.endswith("rerun-failed-jobs"):
                raise RuntimeError("unavailable")
            return original_api(suffix, method, payload)

        self.gh.api = failing_api
        with self.assertRaises(RuntimeError):
            self.poll()
        self.assertEqual(self.state["handled"], [])
        self.gh.api = original_api
        self.poll()
        self.assertEqual(len(self.gh.mutations), 2)

    def test_applied_routing_timeout_keeps_monthly_reset(self):
        original_set_mode = self.gh.set_mode

        def applied_then_failed(mode):
            original_set_mode(mode)
            raise RuntimeError("response lost")

        self.gh.set_mode = applied_then_failed
        with self.assertRaises(RuntimeError):
            self.poll()
        self.assertEqual(self.state["fallback_month"], "2026-10")
        self.gh.set_mode = original_set_mode
        self.poll()
        self.gh.runs = []
        self.poll(now=dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc))
        self.assertEqual(self.gh.routing, "github")


class GitHubContractTests(unittest.TestCase):
    def test_main_requires_current_head(self):
        from fallback import GitHub
        gh = GitHub("gh", "kolengri/VibeShape")
        branch = {"commit": {"sha": "abc"}}
        gh.api = lambda suffix: branch
        run = {"event": "push", "head_branch": "main", "head_sha": "abc"}
        self.assertTrue(gh.current_trusted(run, "kolengri", "kolengri/VibeShape"))
        run["head_sha"] = "old"
        self.assertFalse(gh.current_trusted(run, "kolengri", "kolengri/VibeShape"))

    def test_source_must_include_selector_at_original_commit(self):
        from fallback import GitHub
        gh = GitHub("gh", "kolengri/VibeShape")
        gh.api = lambda suffix: {"content": base64.b64encode(VARIABLE.encode()).decode()}
        self.assertTrue(gh.supports_routing({"path": ".github/workflows/ci.yml", "head_sha": "abc"}))
        gh.api = lambda suffix: {"content": base64.b64encode(b"runs-on: ubuntu-latest").decode()}
        self.assertFalse(gh.supports_routing({"path": ".github/workflows/ci.yml", "head_sha": "abc"}))

    def test_pull_request_requires_owner_same_repo_and_current_head(self):
        from fallback import GitHub
        gh = GitHub("gh", "kolengri/VibeShape")
        pr = {"state": "open", "user": {"login": "kolengri"},
              "head": {"sha": "abc", "repo": {"full_name": "kolengri/VibeShape"}}}
        gh.api = lambda suffix: pr
        run = {"event": "pull_request", "pull_requests": [{"number": 1}], "head_sha": "abc"}
        self.assertTrue(gh.current_trusted(run, "kolengri", "kolengri/VibeShape"))
        for change in ({"sha": "old"}, {"repo": {"full_name": "someone/fork"}}, {"repo": None}):
            original = pr["head"].copy()
            pr["head"].update(change)
            self.assertFalse(gh.current_trusted(run, "kolengri", "kolengri/VibeShape"))
            pr["head"] = original
        pr["user"]["login"] = "someone"
        self.assertFalse(gh.current_trusted(run, "kolengri", "kolengri/VibeShape"))

    def test_check_annotation_requires_an_unstarted_failed_job(self):
        annotation = [{"annotation_level": "failure", "message": MESSAGE}]
        self.assertTrue(billing_blocked({"conclusion": "failure"}, annotation))
        self.assertFalse(billing_blocked({"conclusion": "success"}, annotation))
        self.assertFalse(billing_blocked({"conclusion": "failure"}, [{"annotation_level": "warning", "message": MESSAGE}]))


if __name__ == "__main__":
    unittest.main()
