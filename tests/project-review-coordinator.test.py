"""Offline coordinator integration tests. No real provider or production store writes."""
import importlib.util
from pathlib import Path
import datetime
import json
import tempfile
import unittest
import sys

spec = importlib.util.spec_from_file_location('project_review', Path(__file__).parents[1] / 'scripts/dev/project-review-coordinator.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
b = module.base


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='judoju-review-policy-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'root'
        self.root.mkdir()
        (self.root / 'file.txt').write_text('revision0')
        plan = {'status': 'SEALED', 'sealedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'economicPolicy': {'maxPlanAgeHours': 168}, 'profiles': [
                {'model': 'fixture-codex', 'reasoningEffort': 'ultra'}, {'model': 'fixture-claude', 'reasoningEffort': 'medium'}]}
        planpath = self.root / 'plan.json'
        planpath.write_text(json.dumps(plan))
        planpath.with_suffix('.sha256').write_text(b.sha(planpath.read_bytes()))
        root = self.root
        class FixtureService(module.ProjectService):
            bound_root = root
        self.service = FixtureService(Path(self.temp.name) / 'state', roles=['claude', 'codex'])
        self.addCleanup(self.service.db.close)
        self.task = 'fixture-task'
        self.check = {'name': 'local', 'argv': [sys.executable, '-c', 'print("fixture pass")'], 'cwd': '.'}
        self.call('register', {'root': str(root), 'required_roles': ['claude', 'codex'], 'scope': ['file.txt'],
            'authorization': {'claude': 'synthetic', 'codex': 'synthetic'}, 'plan': str(planpath),
            'claude_track': 'PREVIOUS', 'required_checks': {'local': {'argv': self.check['argv'], 'cwd': '.'}}})
        self.call('begin', {'root': str(root), 'task': self.task, 'turn': 'fixture-turn', 'authoring': True, 'origin': 'author'})

    def call(self, command, value):
        if command == 'run_check':
            return self.service.run_check(value)
        with self.service.transaction():
            return getattr(self.service, command)(value)

    def prepare(self, revision):
        (self.root / 'file.txt').write_text('revision' + str(revision))
        receipt = self.call('run_check', {**self.check, 'task': self.task, 'paths': ['file.txt'], 'timeout': 30})
        return self.call('prepare', {'task': self.task, 'paths': ['file.txt'], 'purpose': 'WORK_READY_FOR_REVIEW: fixture',
            'criteria': 'DUAL current source and checks', 'checks': [receipt]})

    def review(self, candidate, role, verdict='CHANGES_REQUIRED', reserve_only=False, input_mode='FILES'):
        destination = 'fixture:' + role
        locked = self.call('lock', {'candidate': candidate['id'], 'role': role, 'destination': destination})
        token = locked['token']
        self.call('bind', {'candidate': candidate['id'], 'role': role, 'destination': destination, 'lock_token': token,
            'model': 'fixture-' + role, 'effort': 'ultra' if role == 'codex' else 'medium',
            'observation': 'synthetic only', 'resolution_source': 'synthetic', 'host_supports_exact': True,
            'track': 'PREVIOUS', 'track_mapping_verified': True})
        rows = [row for row in self.service._case_requests(candidate['case_id']) if row['role'] == role and row['execution_status'] == 'COMPLETE']
        parents = [rows[-1]['key']] if rows else []
        args = {'candidate': candidate['id'], 'role': role, 'destination': destination, 'lock_token': token,
            'phase': 'REVIEW_CHANGE' if parents else 'INDEPENDENT', 'parents': parents,
            'content': 'synthetic review revision ' + candidate['manifest_sha256'], 'input_mode': input_mode}
        reservation = self.call('reserve', args)
        if reserve_only:
            return reservation, args
        self.call('dispatch', {'key': reservation['key'], 'destination': destination, 'lock_token': token,
            'payload_sha256': reservation['payload_sha256'], 'observed_model': 'fixture-' + role,
            'observed_effort': 'ultra' if role == 'codex' else 'medium'})
        self.call('accept', {'key': reservation['key'], 'provider_reference': 'SYNTHETIC', 'evidence': 'offline fixture only'})
        report = {'key': reservation['key'], 'role': role, 'manifest_sha256': candidate['manifest_sha256'],
            'verdict': verdict, 'findings': [] if verdict == 'READY' else [{'id': 'fixture', 'severity': 'P2', 'description': 'synthetic', 'location': 'file.txt'}], 'limitations': ['synthetic no provider']}
        completed = self.call('complete', {'key': reservation['key'], 'raw_response': json.dumps(report), 'report': report,
            'generation_ended': True, 'evidence': 'synthetic', 'input_assurance': 'EXACT_BYTES',
            'model_assurance': 'HOST_ACCEPTED' if role == 'codex' else 'UI_OBSERVED'})
        return completed

    def enable(self):
        return self.call('enable_unlimited_revisions', {'root': str(self.root), 'task': self.task,
            'authorization': 'explicit synthetic removal of revision cap', 'evidence': 'fixture user instruction'})

    def test_twelve_changed_revisions_keep_same_case_history_and_dual_completion(self):
        first = self.prepare(1)
        initial = [self.review(first, role) for role in ('claude', 'codex')]
        mode = self.enable()
        for revision in range(2, 13):
            candidate = self.prepare(revision)
            self.assertEqual(candidate['case_id'], first['case_id'])
            for role in ('claude', 'codex'):
                self.review(candidate, role, 'READY' if revision == 12 else 'CHANGES_REQUIRED')
        self.assertEqual(len(self.service._case_requests(first['case_id'])), 24)
        for request in initial:
            self.assertEqual(b.sha(self.service.request(request['key'])), mode['historical_requests'][request['key']])
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')

    def test_provider_block_survives_begin_and_cannot_be_retired_as_count_limit(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.call('blocked', {'task': self.task, 'reason': 'provider login required', 'evidence': 'synthetic'})
        self.enable()
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'next', 'authoring': True, 'origin': 'author'})
        self.assertEqual(self.service.get('task', self.task)['blocked_reason'], 'provider login required')
        with self.assertRaisesRegex(b.ReviewError, 'TASK_REVIEW_BLOCKED'):
            self.prepare(2)

    def test_only_recorded_count_block_is_recovered_and_original_proof_remains(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.call('blocked', {'task': self.task, 'reason': self.service.count_only_reason, 'evidence': 'synthetic'})
        prior = self.service.get('task', self.task)['blocked_evidence']
        mode = self.enable()
        self.assertNotIn('blocked_reason', self.service.get('task', self.task))
        proof = json.loads((self.service.home / 'evidence' / (mode['evidence'] + '.json')).read_bytes())
        self.assertEqual(proof['prior_task']['blocked_evidence'], prior)
        self.assertTrue((self.service.home / 'evidence' / (prior + '.json')).exists())

    def test_policy_is_scoped_and_old_history_tampering_fails_closed(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        mode = self.enable()
        with self.assertRaisesRegex(b.ReviewError, 'PROJECT_POLICY_SCOPE'):
            self.call('enable_unlimited_revisions', {'root': self.temp.name, 'task': self.task, 'authorization': 'fixture', 'evidence': 'fixture'})
        key = next(iter(mode['historical_requests']))
        damaged = self.service.request(key)
        damaged['reviewer_verdict'] = 'READY'
        self.service.save_request(damaged)
        self.service.db.commit()
        with self.assertRaisesRegex(b.ReviewError, 'PROJECT_HISTORICAL_REQUEST_CHANGED'):
            self.prepare(2)

    def test_single_ready_does_not_complete_or_skip_sibling_review(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.enable()
        second = self.prepare(2)
        self.review(second, 'claude', 'READY')
        self.assertNotEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')
        with self.assertRaisesRegex(b.ReviewError, 'PROJECT_PREVIOUS_DUAL_INCOMPLETE'):
            self.prepare(3)

    def test_new_turn_continues_durable_case_predecessor(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.enable()
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'next', 'authoring': True, 'origin': 'author'})
        second = self.prepare(2)
        self.assertEqual(second['case_id'], first['case_id'])
        for role in ('claude', 'codex'):
            self.review(second, role)

    def test_partial_legacy_activation_is_deferred_until_both_complete(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        second = self.prepare(2)
        self.review(second, 'claude')
        with self.assertRaisesRegex(b.ReviewError, 'PROJECT_ACTIVATION_DUAL_INCOMPLETE'):
            self.enable()
        self.review(second, 'codex')
        self.enable()
        self.assertEqual(self.prepare(3)['case_id'], first['case_id'])

    def test_completed_source_recheck_preserves_original_case_and_requests(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.enable()
        second = self.prepare(2)
        for role in ('claude', 'codex'):
            self.review(second, role, 'READY')
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'recheck', 'authoring': True, 'origin': 'author'})
        again = self.prepare(2)
        self.assertEqual(again['case_id'], second['case_id'])
        self.assertEqual(again['requests'], self.service.get('candidate', second['id'])['requests'])
        self.assertEqual(len(self.service._case_requests(first['case_id'])), 4)
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')

    def test_existing_round_rechecks_parent_evidence_before_use(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.enable()
        second = self.prepare(2)
        parents = self.service.get('project_revision_round', second['case_id'] + '/' + second['manifest_sha256'])['grant']['prior_reports']
        (self.service.home / 'evidence' / (parents['claude']['report_sha256'] + '.json')).unlink()
        with self.assertRaises((b.ReviewError, OSError)):
            self.review(second, 'claude')

    def test_mixed_count_and_provider_block_is_not_cleared(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        reason = self.service.count_only_reason + ' provider login is also required'
        self.call('blocked', {'task': self.task, 'reason': reason, 'evidence': 'synthetic'})
        self.enable()
        self.assertEqual(self.service.get('task', self.task)['blocked_reason'], reason)

    def test_completed_legacy_candidate_revalidates_without_new_case(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        second = self.prepare(2)
        for role in ('claude', 'codex'):
            self.review(second, role, 'READY')
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')
        self.enable()
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'legacy-recheck', 'authoring': True, 'origin': 'author'})
        again = self.prepare(2)
        self.assertEqual(again['case_id'], first['case_id'])
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')
        self.assertEqual(len(self.service._case_requests(first['case_id'])), 4)

    def test_activation_after_ready_before_status_keeps_legacy_completion(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        second = self.prepare(2)
        for role in ('claude', 'codex'):
            self.review(second, role, 'READY')
        self.enable()
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')

    def test_root_activation_does_not_strand_another_partial_legacy_task(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        partial = self.prepare(2)
        self.review(partial, 'claude')
        self.task = 'second-task'
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'second', 'authoring': True, 'origin': 'author'})
        other = self.prepare(2)
        for role in ('claude', 'codex'):
            self.review(other, role)
        self.enable()
        self.review(partial, 'codex')
        self.assertNotEqual(self.call('status', {'task': 'fixture-task'})['work_status'], 'REVIEW_BLOCKED')

    def test_recheck_requires_current_ready_raw_reports_not_only_parents(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        self.enable()
        second = self.prepare(2)
        done = {role: self.review(second, role, 'READY') for role in ('claude', 'codex')}
        self.assertEqual(self.call('status', {'task': self.task})['work_status'], 'WORK_COMPLETE')
        (self.service.home / 'evidence' / (done['claude']['report_sha256'] + '.json')).unlink()
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'lost-report', 'authoring': True, 'origin': 'author'})
        with self.assertRaises((b.ReviewError, OSError)):
            self.prepare(2)

    def test_root_activation_keeps_reserved_legacy_dispatch(self):
        first = self.prepare(1)
        for role in ('claude', 'codex'):
            self.review(first, role)
        partial = self.prepare(2)
        reservation, args = self.review(partial, 'claude', reserve_only=True)
        self.task = 'second-task'
        self.call('begin', {'root': str(self.root), 'task': self.task, 'turn': 'second', 'authoring': True, 'origin': 'author'})
        other = self.prepare(2)
        self.enable()
        self.call('dispatch', {'key': reservation['key'], 'destination': args['destination'],
            'lock_token': args['lock_token'], 'payload_sha256': reservation['payload_sha256'],
            'observed_model': 'fixture-claude', 'observed_effort': 'medium'})
        self.assertEqual(self.service.request(reservation['key'])['execution_status'], 'DISPATCH_UNCERTAIN')

    def test_confirmed_unsent_transport_repackage_preserved(self):
        self.enable()
        first = self.prepare(1)
        reservation, args = self.review(first, 'claude', reserve_only=True, input_mode='INLINE')
        self.call('resolve', {'key': reservation['key'], 'resolution': 'NOT_SENT_CONFIRMED', 'evidence': 'offline never sent',
            'provider_idle': True, 'send_uncertainty_resolved': True})
        args['lock_token'] = self.call('lock', {'candidate': first['id'], 'role': 'claude',
            'destination': args['destination']})['token']
        result = self.call('repackage_not_sent', {**args, 'key': reservation['key'], 'input_mode': 'FILES',
            'authorization': 'fixture transport correction', 'evidence': 'offline never sent',
            'provider_idle': True, 'send_uncertainty_resolved': True})
        self.assertEqual(result['repackaged_from'], reservation['key'])
        self.assertEqual(self.service.request(reservation['key'])['execution_status'], 'SUPERSEDED_NOT_SENT')


if __name__ == '__main__':
    unittest.main()
