"""Exercise routing expressions and the aggregate shell from the actual workflow."""

import itertools
import os
from pathlib import Path
import re
import subprocess
import textwrap
import unittest

WORKFLOW = (Path(__file__).resolve().parents[2] / '.github/workflows/ci.yml').read_text()


def expression(job, values):
    body = WORKFLOW.split(f'  {job}:\n', 1)[1]
    condition = re.search(r'^    if: \$\{\{ (.+) \}\}$', body, re.M).group(1)
    condition = re.sub(r'\b(?:github|vars|inputs|needs)\.[A-Za-z0-9_.-]+',
                       lambda match: repr(values[match[0]]), condition)
    condition = re.sub(r'!(?!=)', ' not ', condition.replace('&&', ' and ').replace('||', ' or '))
    return eval(condition, {'__builtins__': {}, 'startsWith': lambda a, b: a.startswith(b),
                            'cancelled': lambda: values.get('cancelled', False)})


class WorkflowTests(unittest.TestCase):
    def test_only_owner_runs_and_supported_callers_prefer_mac(self):
        for flag, manual, actor, trigger, author, same_head, caller, event in itertools.product(
                (False, True), (False, True), ('kolengri', 'contributor'),
                ('', 'kolengri', 'contributor'), ('kolengri', 'contributor'), (False, True),
                ('ci.yml', 'cloudflare-pages.yml', 'desktop-release.yml'), ('pull_request', 'push')):
            values = {'vars.VIBESHAPE_CI_HYBRID': str(flag).lower(), 'inputs.hybrid': manual,
                      'github.workflow_ref': f'kolengri/VibeShape/.github/workflows/{caller}@refs/heads/main',
                      'github.repository': 'kolengri/VibeShape', 'github.repository_owner': 'kolengri',
                      'github.actor': actor, 'github.triggering_actor': trigger, 'github.event_name': event,
                      'github.event.pull_request.head.repo.full_name': 'kolengri/VibeShape' if same_head else 'fork/VibeShape',
                      'github.event.pull_request.user.login': author}
            expected = ((flag or manual) and actor == 'kolengri' and trigger != 'contributor'
                        and caller != 'desktop-release.yml'
                        and (event != 'pull_request' or (same_head and author == 'kolengri')))
            with self.subTest(values=values):
                self.assertEqual(expression('mac-ci', values), expected)
        values['github.repository'] = 'fork/VibeShape'
        self.assertFalse(expression('mac-ci', values))

    def test_hosted_jobs_run_only_without_a_mac_request_or_after_unavailability(self):
        for state, outcome, cancelled in itertools.product(
                ('success', 'failure', 'skipped', 'cancelled'), ('success', 'unavailable', ''), (False, True)):
            values = {'needs.mac-ci.result': state, 'needs.mac-ci.outputs.result': outcome,
                      'cancelled': cancelled}
            expected = not cancelled and (state == 'skipped' or (state == 'success' and outcome == 'unavailable'))
            for job in ('checks', 'unit-tests'):
                self.assertEqual(expression(job, values), expected)

    def test_aggregate_accepts_only_complete_mac_or_complete_hosted_verification(self):
        body = WORKFLOW.split('  verify:\n', 1)[1]
        script = textwrap.dedent(body.split('        run: |\n', 1)[1])
        states = ('success', 'failure', 'skipped', 'cancelled')
        for mac, outcome, checks, units in itertools.product(
                states, ('success', 'unavailable', ''), states, states):
            values = {'MAC_RESULT': mac, 'MAC_OUTCOME': outcome,
                      'CHECKS_RESULT': checks, 'UNIT_TESTS_RESULT': units}
            expected = ((mac == outcome == 'success' and checks == units == 'skipped')
                        or ((mac == 'skipped' or (mac == 'success' and outcome == 'unavailable'))
                            and checks == units == 'success'))
            result = subprocess.run(['/bin/bash', '-e', '-c', script],
                                    env={**os.environ, **values}, capture_output=True)
            with self.subTest(values=values):
                self.assertEqual(result.returncode == 0, expected)
