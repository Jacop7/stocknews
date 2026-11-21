"""Project-scoped continuation of the installed shared DUAL coordinator.

No provider calls, credential handling, deployment or global runtime installation.
Historical cases/once grants remain unchanged. Only changed-revision limits change.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import types


RUNTIME_HOME = Path.home() / '.codex' / 'review-service' / 'v1'
pointer = json.loads((RUNTIME_HOME / 'current.json').read_bytes())
if 'review_service.py' not in pointer['files']:
    raise RuntimeError('RUNTIME_MODULE_NOT_PINNED')
release = (RUNTIME_HOME / 'releases' / pointer['release']).resolve()
if not release.is_relative_to((RUNTIME_HOME / 'releases').resolve()):
    raise RuntimeError('INVALID_RUNTIME_PATH')
import hashlib
for name, expected in pointer['files'].items():
    target = (release / name).resolve()
    if not target.is_relative_to(release) or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise RuntimeError('RUNTIME_HASH_MISMATCH')
    if name == 'review_service.py':
        verified_module = target.read_bytes()
        if hashlib.sha256(verified_module).hexdigest() != expected:
            raise RuntimeError('RUNTIME_HASH_MISMATCH')
base = types.ModuleType('judoju_installed_review')
base.__file__ = str(release / 'review_service.py')
exec(compile(verified_module, base.__file__, 'exec'), base.__dict__)


class ProjectService(base.Service):
    bound_root = Path(r'C:\Users\jacop\주식')
    count_only_reason = ('REVIEW_BLOCKED: latest corrective delta needs fifth same-case candidate; '
        'official exact-fourth-manifest grant is immutable and latest prepare returned REVIEW_CHANGE_ONCE_EPOCH_WATCH_MISMATCH. '
        'No provider dispatch/review approval is being inferred.')

    def _predecessor(self, case):
        return next((candidate for key in reversed(case['candidates'])
            if (candidate := self.get('candidate', key))['requests']), None)

    def _parents_valid(self, grant):
        for role, parent in grant['prior_reports'].items():
            request = self.request(parent['key'])
            base.require(request['execution_status'] == 'COMPLETE' and
                base.sha(request) == grant['prior_request_sha256s'][role] and
                request['report_sha256'] == parent['report_sha256'], 'PROJECT_PARENT_REQUEST_CHANGED')
            proof = self.home / 'evidence' / (parent['report_sha256'] + '.json')
            base.require(base.sha(proof.read_bytes()) == parent['report_sha256'], 'PROJECT_PARENT_REPORT_CHANGED')
            report = json.loads(proof.read_bytes())['report']
            base.require(report['key'] == request['key'] and report['role'] == role and report['verdict'] != 'DISPUTED', 'PROJECT_DISPUTED_PARENT')

    def _current_reports_valid(self, candidate):
        for role, key in candidate['requests'].items():
            request = self.request(key)
            if request['execution_status'] != 'COMPLETE':
                continue
            proof = self.home / 'evidence' / (request['report_sha256'] + '.json')
            base.require(base.sha(proof.read_bytes()) == request['report_sha256'], 'PROJECT_CURRENT_REPORT_CHANGED')
            report = json.loads(proof.read_bytes())['report']
            base.require(report['key'] == key and report['role'] == role and report['manifest_sha256'] == candidate['manifest_sha256'] and
                report['verdict'] == request['reviewer_verdict'], 'PROJECT_CURRENT_REPORT_CHANGED')

    def _eligible(self, task):
        return task['root'] == base.root_path(self.bound_root) and not self._c2(task)

    def _mode(self, task):
        if not self._eligible(task):
            return None
        mode = self.get('project_revision_policy', task['root'], True)
        if not mode:
            return None
        base.require(mode['root'] == task['root'] and mode['mode'] == 'UNLIMITED_CHANGED_REVISIONS', 'PROJECT_POLICY_SCOPE')
        proof = self.home / 'evidence' / (mode['evidence'] + '.json')
        base.require(base.sha(proof.read_bytes()) == mode['evidence'], 'PROJECT_POLICY_EVIDENCE_CHANGED')
        authority = json.loads(proof.read_bytes())
        base.require(authority['kind'] == 'PROJECT_UNLIMITED_REVISIONS' and
            base.root_path(authority['authorization']['root']) == mode['root'] and
            authority['historical_requests'] == mode['historical_requests'], 'PROJECT_POLICY_EVIDENCE_CHANGED')
        for key, digest in mode['historical_requests'].items():
            request = self.request(key)
            base.require(base.sha(request) == digest, 'PROJECT_HISTORICAL_REQUEST_CHANGED')
            report = self.home / 'evidence' / (request['report_sha256'] + '.json')
            base.require(base.sha(report.read_bytes()) == request['report_sha256'], 'PROJECT_HISTORICAL_REPORT_CHANGED')
        return mode

    def enable_unlimited_revisions(self, args):
        base.require(set(args) == {'root', 'task', 'authorization', 'evidence'}, 'PROJECT_POLICY_FIELDS')
        task = self.get('task', args['task'])
        base.require(self._eligible(task) and base.root_path(args['root']) == task['root'], 'PROJECT_POLICY_SCOPE')
        base.require(args['authorization'].strip() and args['evidence'].strip(), 'PROJECT_POLICY_AUTHORIZATION')
        project = self.get('project', task['root'])
        base.require(set(project['required_roles']) == set(base.ROLES), 'PROJECT_DUAL_REQUIRED')
        old = self._mode(task)
        if old:
            if task.get('blocked_reason') == self.count_only_reason:
                proof = self.evidence({'kind': 'PROJECT_COUNT_BLOCK_RECOVERY', 'authorization': args, 'prior_task': task})
                task.pop('blocked_reason', None)
                task.pop('blocked_evidence', None)
                task['revision_policy_recovery'] = proof
                self.put('task', task['task'], task)
            return old
        requests = self._case_requests(task['case_id']) if task.get('case_id') else []
        base.require(not any(row['execution_status'] in base.ACTIVE for row in requests), 'PROJECT_ACTIVE_REQUEST')
        completed = [row for row in requests if row['execution_status'] == 'COMPLETE']
        predecessor = self._predecessor(self.get('case', task['case_id'])) if task.get('case_id') else None
        base.require(not predecessor or set(predecessor['requests']) == set(base.ROLES) and
            all(self.request(key)['execution_status'] == 'COMPLETE' for key in predecessor['requests'].values()), 'PROJECT_ACTIVATION_DUAL_INCOMPLETE')
        # Only a count-derived block is retired. Provider/login/disputed/transport blocks persist.
        block = task.get('blocked_reason', '')
        count_block = block == self.count_only_reason
        proof = self.evidence({'kind': 'PROJECT_UNLIMITED_REVISIONS', 'authorization': args,
            'prior_task': task, 'historical_requests': {row['key']: base.sha(row) for row in completed},
            'count_block_retired': count_block})
        mode = {'root': task['root'], 'mode': 'UNLIMITED_CHANGED_REVISIONS', 'evidence': proof,
            'historical_requests': {row['key']: base.sha(row) for row in completed}}
        self.put('project_revision_policy', task['root'], mode)
        if count_block:
            task.pop('blocked_reason', None)
            task.pop('blocked_evidence', None)
            task['revision_policy_recovery'] = proof
            self.put('task', task['task'], task)
        return mode

    def begin(self, args):
        old = self.get('task', args['task'], True)
        block = {key: old[key] for key in ('blocked_reason', 'blocked_evidence') if old and key in old}
        result = super().begin(args)
        if old and self._mode(old) and block:
            result.update(block)
            self.put('task', result['task'], result)
        return result

    def prepare(self, args):
        task = self.get('task', args['task'])
        base.require(task['origin'] == 'author', 'REVIEW_ORIGIN_EXCLUDED')
        if self._mode(task):
            base.require(not task.get('blocked_reason'), 'TASK_REVIEW_BLOCKED')
            config = self.get('project', task['root'])
            targets = self.targets(task, config, args['paths'])
            identity = base.sha({'root': task['root'], 'task': task['task'], 'manifest': targets,
                'purpose': args.get('purpose'), 'criteria': args.get('criteria'), 'policy': config})
            old = self.get('candidate', identity, True)
            if old and self.get('case', old['case_id'])['completed']:
                current = self.get('case', task.get('case_id') or '', True)
                base.require(not current or current['completed'] or current['id'] == old['case_id'], 'PROJECT_OPEN_CASE_REENTRY')
                self.validate_checks(task, self.observe(task), targets, args['checks'])
                base.require(all(check['status'] == 'PASS' for check in args['checks']), 'PROJECT_CHECKS_NOT_PASS')
                base.require(self.plan(config) == old['plan_sha256'], 'MODEL_PLAN_CHANGED')
                self._current_reports_valid(old)
                old.update(epoch=task['epoch'], watch=self.observe(task), checks=args['checks'])
                task.update(candidate=old['id'], case_id=old['case_id'], dirty=True)
                self.put('candidate', old['id'], old)
                self.put('task', task['task'], task)
                return old
        return super().prepare(args)

    def _change_context(self, task, config, live, targets, checks, purpose, criteria):
        mode = self._mode(task)
        if not mode:
            return super()._change_context(task, config, live, targets, checks, purpose, criteria)
        base.require(not task.get('blocked_reason'), 'TASK_REVIEW_BLOCKED')
        case = self.get('case', task['case_id'])
        base.require((purpose, criteria) == (case['purpose'], case['criteria']), 'OPEN_CASE_SCOPE_CHANGED')
        base.require(set(config['required_roles']) == set(base.ROLES), 'PROJECT_DUAL_REQUIRED')
        self.validate_checks(task, live, targets, checks)
        base.require(all(check['status'] == 'PASS' for check in checks), 'PROJECT_CHECKS_NOT_PASS')
        self.plan(config)
        for binding in case['bindings'].values():
            self.plan(config, binding)
        identity = case['id'] + '/' + base.sha(targets)
        existing = self.get('project_revision_round', identity, True)
        if existing:
            base.require(base.sha(existing['grant']) == existing['grant_sha256'], 'PROJECT_ROUND_CHANGED')
            proof = self.home / 'evidence' / (existing['grant_evidence'] + '.json')
            base.require(base.sha(proof.read_bytes()) == existing['grant_evidence'] and json.loads(proof.read_bytes()) == existing['grant'], 'PROJECT_ROUND_CHANGED')
            base.require(existing['grant']['bindings_sha256'] == base.sha(case['bindings']), 'PROJECT_BINDINGS_CHANGED')
            self._parents_valid(existing['grant'])
            return existing
        rows = self._case_requests(case['id'])
        if len(case['candidates']) == 1 and all(row['semantic']['manifest'] == targets and row['semantic']['phase'] == 'INDEPENDENT' for row in rows):
            return None
        previous = self._predecessor(case)
        if previous and previous['manifest'] == targets or base.sha(targets) in self._sent_manifests(case['id']):
            base.require(case['completed'] or previous and previous['manifest'] == targets, 'PROJECT_HISTORICAL_MANIFEST_REUSE_ONLY')
            if previous and previous['manifest'] == targets:
                self._current_reports_valid(previous)
            once = self.get('review_change_once', case['id'], True)
            if once and once['grant']['manifest'] == targets:
                base.require(base.sha(once['grant']) == once['grant_sha256'] and
                    once['grant']['bindings_sha256'] == base.sha(case['bindings']), 'PROJECT_LEGACY_GRANT_CHANGED')
                return once
            return None
        base.require(not any(row['execution_status'] in base.ACTIVE for row in rows), 'PROJECT_ACTIVE_REQUEST')
        latest = {}
        for row in rows:
            if row['execution_status'] == 'COMPLETE':
                latest[row['role']] = {'key': row['key'], 'report_sha256': row['report_sha256']}
        base.require(set(latest) == set(base.ROLES), 'PROJECT_DUAL_PARENT_REQUIRED')
        previous = self._predecessor(case)
        base.require(previous and all(previous['requests'].get(role) == latest[role]['key'] for role in base.ROLES), 'PROJECT_PREVIOUS_DUAL_INCOMPLETE')
        for parent in latest.values():
            proof = self.home / 'evidence' / (parent['report_sha256'] + '.json')
            base.require(base.sha(proof.read_bytes()) == parent['report_sha256'], 'PROJECT_PARENT_REPORT_CHANGED')
            report = json.loads(proof.read_bytes())['report']
            base.require(report['verdict'] != 'DISPUTED', 'PROJECT_DISPUTED_PARENT')
        grant = {'kind': 'PROJECT_CHANGED_REVISION', 'root': task['root'], 'case_id': case['id'],
            'task': task['task'], 'manifest': targets, 'manifest_sha256': base.sha(targets),
            'prior_reports': latest, 'prior_request_sha256s': {role: base.sha(self.request(pin['key'])) for role, pin in latest.items()},
            'bindings_sha256': base.sha(case['bindings']), 'policy_evidence': mode['evidence']}
        state = {'project_revision': True, 'grant': grant, 'grant_sha256': base.sha(grant),
            'grant_evidence': self.evidence(grant), 'candidate': None, 'role_keys': {}}
        self._save_change_context(state, case['id'])
        return state

    def _save_change_context(self, state, case_id):
        if not state.get('project_revision'):
            return super()._save_change_context(state, case_id)
        key = case_id + '/' + state['grant']['manifest_sha256']
        old = self.get('project_revision_round', key, True)
        base.require(not old or old['grant_sha256'] == state['grant_sha256'], 'PROJECT_ROUND_CHANGED')
        if old:
            base.require(all(state['role_keys'].get(role) == value for role, value in old['role_keys'].items()), 'PROJECT_ROLE_KEY_CHANGED')
        self.put('project_revision_round', key, state)

    def _attach_review_change_once(self, state, candidate):
        if not state or not state.get('project_revision'):
            return super()._attach_review_change_once(state, candidate)
        base.require(state['candidate'] in (None, candidate['id']), 'PROJECT_CANDIDATE_CHANGED')
        state['candidate'] = candidate['id']
        candidate['project_revision'] = state['grant_sha256']
        # Legacy reservation uses the same exact-parent/key protections, without its revision cap.
        candidate['review_change_once'] = state['grant_sha256']
        self._save_change_context(state, candidate['case_id'])

    def lock(self, args):
        candidate = self.get('candidate', args['candidate'])
        task = self.get('task', candidate['task'])
        if self._mode(task):
            base.require(not task.get('blocked_reason'), 'TASK_REVIEW_BLOCKED')
        return super().lock(args)

    def complete(self, args):
        request = self.request(args['key'])
        candidate = self.get('candidate', request['candidate'])
        if candidate.get('project_revision'):
            state = self.get('project_revision_round', candidate['case_id'] + '/' + candidate['manifest_sha256'])
            self._parents_valid(state['grant'])
        return super().complete(args)

    def reserve(self, args):
        candidate = self.get('candidate', args['candidate'])
        task = self.get('task', candidate['task'])
        key = candidate['requests'].get(args['role']) if self._mode(task) else None
        result = super().reserve(args)
        base.require(not key or result['key'] == key or getattr(self, '_audited_repackage', None) == key,
            'PROJECT_EXISTING_ROLE_REQUEST_REUSE_ONLY')
        return result

    def repackage_not_sent(self, args):
        self._audited_repackage = args['key']
        try:
            return super().repackage_not_sent(args)
        finally:
            self._audited_repackage = None

    def status(self, args):
        task = self.get('task', args['task'])
        if self._mode(task) and task.get('candidate'):
            self._current_reports_valid(self.get('candidate', task['candidate']))
        return super().status(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=sorted(set(base.COMMANDS) | {'enable_unlimited_revisions'}))
    parser.add_argument('--home', required=True)
    parser.add_argument('--input')
    args = parser.parse_args()
    try:
        data = json.loads(Path(args.input).read_text(encoding='utf-8-sig') if args.input else sys.stdin.read())
        service = ProjectService(Path(args.home))
        with service.operation_guard(args.command, data):
            if args.command == 'run_check':
                result = service.run_check(data)
            else:
                with service.transaction():
                    result = getattr(service, args.command)(data)
        print(json.dumps(result, ensure_ascii=False))
    except (base.ReviewError, OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
