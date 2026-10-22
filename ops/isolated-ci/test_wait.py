import unittest

from wait import REPOSITORY, result_context, result_state, wait


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


if __name__ == "__main__":
    unittest.main()
