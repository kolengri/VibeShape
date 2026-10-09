import unittest

from preflight import check_preflight


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "GITHUB_REPOSITORY": "kolengri/VibeShape", "GITHUB_REF": "refs/heads/main",
            "GITHUB_SHA": "a" * 40, "KERNEL_ASSET_ID": "123",
        }
        self.branch = {"protected": True, "commit": {"sha": "a" * 40}}
        self.asset = {"id": 123, "size": 1024}
        self.requests = []

    def read_api(self, path):
        self.requests.append(path)
        return self.branch if path.endswith("branches/main") else self.asset

    def test_ready_source_checks_branch_and_asset(self):
        check_preflight(self.environment, self.read_api)
        self.assertEqual(self.requests, ["repos/kolengri/VibeShape/branches/main",
                                         "repos/kolengri/VibeShape/releases/assets/123"])

    def test_invalid_configuration_never_reads_github(self):
        for key, value in (("GITHUB_REPOSITORY", "../other"), ("GITHUB_REF", "refs/heads/feature"),
                           ("GITHUB_SHA", "latest"), ("KERNEL_ASSET_ID", "")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_preflight({**self.environment, key: value}, self.read_api)
        self.assertEqual(self.requests, [])

    def test_current_main_does_not_require_paid_branch_protection(self):
        for branch in ({"protected": False, "commit": {"sha": "a" * 40}},
                       {"commit": {"sha": "a" * 40}}):
            with self.subTest(branch=branch):
                self.branch = branch
                self.requests = []
                check_preflight(self.environment, self.read_api)
                self.assertEqual(len(self.requests), 2)

    def test_outdated_source_fails_before_asset_request(self):
        for protected in (True, False):
            with self.subTest(protected=protected):
                self.branch = {"protected": protected, "commit": {"sha": "c" * 40}}
                self.requests = []
                with self.assertRaisesRegex(ValueError, "current main"):
                    check_preflight(self.environment, self.read_api)
                self.assertEqual(len(self.requests), 1)

    def test_missing_mismatched_and_empty_assets_fail(self):
        for asset in ({}, {"id": 124, "size": 10}, {"id": 123, "size": 0},
                      {"id": 123, "size": "10"}):
            self.asset = asset
            with self.subTest(asset=asset), self.assertRaisesRegex(ValueError, "unavailable or empty"):
                check_preflight(self.environment, self.read_api)

    def test_api_failure_cannot_allow_deployment(self):
        def unavailable(_path):
            raise RuntimeError("unavailable")
        with self.assertRaises(RuntimeError):
            check_preflight(self.environment, unavailable)


if __name__ == "__main__":
    unittest.main()
