"""Exercise retry conditions and acceptance gates from the production workflows."""

import itertools
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[2]


def job_steps(filename, job):
    workflow = (ROOT / '.github/workflows' / filename).read_text()
    body = workflow.split(f'  {job}:\n', 1)[1]
    body = re.split(r'^  [a-z][a-z-]*:\n', body, maxsplit=1, flags=re.M)[0]
    return {
        block.split('\n', 1)[0]: block
        for block in re.split(r'^      - name: ', body, flags=re.M)[1:]
    }


def evaluate(expression, values):
    expression = re.sub(r'\bsteps\.[A-Za-z0-9_.-]+',
                        lambda match: repr(values.get(match[0], '')), expression)
    return eval(expression.replace('&&', ' and ').replace('||', ' or '),
                {'__builtins__': {}})


def field(block, name):
    return re.search(rf'^        {name}: (.+)$', block, re.M).group(1)


def shell(block):
    return textwrap.dedent(block.split('        run: |\n', 1)[1])


class WorkflowTests(unittest.TestCase):
    def test_transfer_retries_keep_the_exact_key_and_fail_closed(self):
        for job, kind in [('publish', 'site'), ('publish-relay', 'relay')]:
            steps = job_steps('cloudflare-pages.yml', job)
            first = steps[f"Restore this run's verified {kind} transfer"]
            retry = steps[f"Retry this run's verified {kind} transfer"]
            backoff = steps[f'Back off after a {kind} transfer failure']
            gate = steps['Require an exact transfer match']
            self.assertEqual(field(first, 'continue-on-error'), 'true')
            self.assertNotIn('continue-on-error:', retry)
            self.assertEqual(field(first, 'uses'), field(retry, 'uses'))
            self.assertEqual(first.split('        with:\n')[1], retry.split('        with:\n')[1])
            self.assertIn('fail-on-cache-miss: true', retry)
            self.assertNotIn('restore-keys:', retry)
            self.assertEqual(field(backoff, 'run'), 'sleep 30')
            condition = field(retry, 'if')
            self.assertEqual(field(backoff, 'if'), condition)
            acceptance = re.search(r'\$\{\{ (.+) \}\}', field(gate, 'run')).group(1)
            for first_state, retry_state, first_hit, retry_hit in itertools.product(
                    ('success', 'failure', 'skipped', 'cancelled'),
                    ('success', 'failure', 'skipped', 'cancelled'), ('true', 'false', ''), ('true', 'false', '')):
                values = {'steps.transfer.outcome': first_state,
                          'steps.transfer-retry.outcome': retry_state,
                          'steps.transfer.outputs.cache-hit': first_hit,
                          'steps.transfer-retry.outputs.cache-hit': retry_hit}
                expected = ((first_state == 'success' and first_hit == 'true')
                            or (retry_state == 'success' and retry_hit == 'true'))
                self.assertEqual(evaluate(condition, values), first_state == 'failure')
                self.assertEqual(evaluate(acceptance, values), expected)

    def test_publication_gate_requires_success_and_uses_its_url(self):
        steps = job_steps('presentation-site.yml', 'publish')
        gate = steps['Require successful publication']
        env_expressions = dict(re.findall(r'^          ([A-Z_]+): \$\{\{ (.+) \}\}$', gate, re.M))
        cases = [
            ('success', 'https://first.example', 'skipped', '', 'https://first.example'),
            ('failure', 'https://stale.example', 'success', 'https://retry.example', 'https://retry.example'),
            ('failure', '', 'success', 'https://retry.example', 'https://retry.example'),
            ('failure', 'https://stale.example', 'failure', 'https://failed.example', None),
            ('success', '', 'skipped', '', None),
            ('failure', '', 'success', '', None),
            ('cancelled', '', 'skipped', '', None),
        ]
        for first_state, first_url, retry_state, retry_url, expected in cases:
            values = {'steps.deploy-first.outcome': first_state,
                      'steps.deploy-first.outputs.deployment-url': first_url,
                      'steps.deploy-retry.outcome': retry_state,
                      'steps.deploy-retry.outputs.deployment-url': retry_url}
            environment = {}
            for name, expression in env_expressions.items():
                value = evaluate(expression, values)
                environment[name] = str(value).lower() if isinstance(value, bool) else value
            with self.subTest(values=values), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'output'
                result = subprocess.run(['/bin/bash', '-e', '-c', shell(gate)],
                                        env={**os.environ, **environment, 'GITHUB_OUTPUT': str(output)},
                                        capture_output=True)
                self.assertEqual(result.returncode == 0, expected is not None)
                if expected:
                    self.assertEqual(output.read_text(), f'deployment-url={expected}\n')

    def test_publication_retry_rechecks_main_after_backoff(self):
        steps = job_steps('presentation-site.yml', 'publish')
        first = steps['Deploy presentation to its own Pages project']
        retry = steps['Retry presentation publication']
        backoff = steps['Back off and require current main before retrying publication']
        self.assertEqual(field(first, 'continue-on-error'), 'true')
        self.assertNotIn('continue-on-error:', retry)
        self.assertEqual(field(first, 'uses'), field(retry, 'uses'))
        self.assertEqual(first.split('        with:\n')[1], retry.split('        with:\n')[1])
        self.assertEqual(field(backoff, 'if'), field(retry, 'if'))
        for state in ('success', 'failure', 'skipped', 'cancelled'):
            self.assertEqual(evaluate(field(retry, 'if'), {'steps.deploy-first.outcome': state}),
                             state == 'failure')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'sleep').write_text('#!/bin/sh\nprintf "sleep %s\\n" "$1" >> "$CALLS"\n')
            (root / 'gh').write_text('#!/bin/sh\necho gh >> "$CALLS"\nprintf "%s\\n" "$CURRENT_MAIN"\n')
            for name in ('sleep', 'gh'):
                (root / name).chmod(0o755)
            for current_main in ('a' * 40, 'b' * 40, ''):
                calls = root / 'calls'
                calls.write_text('')
                result = subprocess.run(['/bin/bash', '-e', '-c', shell(backoff)],
                                        env={**os.environ, 'PATH': directory, 'CALLS': str(calls),
                                             'CURRENT_MAIN': current_main, 'GITHUB_SHA': 'a' * 40,
                                             'GITHUB_REPOSITORY': 'kolengri/VibeShape'}, capture_output=True)
                self.assertEqual(result.returncode == 0, current_main == 'a' * 40)
                self.assertEqual(calls.read_text(), 'sleep 30\ngh\n')


if __name__ == '__main__':
    unittest.main()
