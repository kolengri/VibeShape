import unittest

from wait import REPOSITORY, result_context, result_state, wait, wait_primary


class ResultTests(unittest.TestCase):
    def status(self, state="success", **values):
        return {"context": result_context(123, 2), "state": state,
                "creator": {"login": "kolengri"},
                "target_url": f"https://github.com/{REPOSITORY}/actions/runs/123",
                **values}

    def test_only_current_owner_run_attempt_can_satisfy_wait(self):
        old = self.status(context=result_context(123, 1))
        another = self.status(context=result_context(124, 2))
        self.assertEqual(result_state([old, another], 123, 2), "pending")
        self.assertEqual(result_state([self.status()], 123, 2), "success")

    def test_result_creator_and_target_are_verified(self):
        for values in [{"creator": None}, {"creator": {"login": "contributor"}},
                       {"target_url": "https://example.com"}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                result_state([self.status(**values)], 123, 2)

    def test_latest_matching_result_wins(self):
        self.assertEqual(result_state([self.status("failure"), self.status()], 123, 2),
                         "failure")

    def test_terminal_results_propagate_and_absent_results_time_out(self):
        for state, expected in [("success", 0), ("failure", 1), ("error", 1)]:
            with self.subTest(state=state):
                self.assertEqual(wait("a" * 40, 123, 2,
                                      fetch=lambda _: [self.status(state)]), expected)
        clock = [0]

        def advance(seconds):
            clock[0] += seconds

        self.assertEqual(wait("a" * 40, 123, 2, timeout=20, fetch=lambda _: [],
                              now=lambda: clock[0], sleep=advance), 1)

    def test_bad_sha_and_identifiers_never_query_results(self):
        def forbidden(_):
            raise AssertionError("Must not query")
        for sha, run, attempt in [("main", 123, 2), ("a" * 40, 0, 2),
                                  ("a" * 40, 123, True)]:
            with self.subTest(sha=sha, run=run), self.assertRaises(ValueError):
                wait(sha, run, attempt, fetch=forbidden)

    def primary(self, responses, **options):
        clock = [0]
        def advance(seconds):
            clock[0] += seconds
        def fetch(_):
            return responses(clock[0])
        result = wait_primary("a" * 40, 123, 2, fetch=fetch,
                              now=lambda: clock[0], sleep=advance, **options)
        return result, clock[0]

    def receipt(self, state="pending", identity=1, **values):
        return self.status(state, context=result_context(123, 2, "ci"), id=identity, **values)

    def test_offline_and_stalled_mac_fall_back_after_90_seconds(self):
        for responses in (lambda _: [], lambda _: [self.receipt()]):
            self.assertEqual(self.primary(responses), (75, 90))

    def test_heartbeats_extend_execution_but_never_satisfy_verification(self):
        def responses(seconds):
            state = "success" if seconds >= 160 else "pending"
            return [self.receipt(state, identity=1 + int(seconds / 30))]
        self.assertEqual(self.primary(responses), (0, 160))
        self.assertEqual(self.primary(lambda t: [self.receipt(identity=int(t) + 1)], timeout=100),
                         (75, 100))

    def test_test_failure_is_terminal_and_infrastructure_error_requests_full_hosted_ci(self):
        for state, expected in (("success", 0), ("failure", 1), ("error", 75)):
            self.assertEqual(self.primary(lambda _: [self.receipt(state)])[0], expected)

    def test_legacy_shard_success_cannot_satisfy_complete_ci(self):
        self.assertEqual(self.primary(lambda _: [self.status()]), (75, 90))

    def test_forged_identity_and_invalid_heartbeat_fail_closed_instead_of_falling_back(self):
        for values in ({"id": None}, {"creator": {"login": "contributor"}},
                       {"target_url": "https://example.com"}):
            receipt = self.receipt() | values
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.primary(lambda _: [receipt])


if __name__ == "__main__":
    unittest.main()
